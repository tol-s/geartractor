import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { Q } from "@/db/columns";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { invitations, sessions, users } from "@/db/schema";
import { ROLE_LABEL } from "@/lib/domain";
import { emailSchema } from "@/lib/validators";
import type { OrgContext } from "./auth/context";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { audit } from "./audit";
import { newToken, sha256 } from "./auth/password";
import { appUrl } from "./qr";

type Ctx = Pick<OrgContext, "orgId" | "user" | "can">;
const INVITE_DAYS = 7;

export const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: emailSchema,
  role: z.enum(["org_admin", "trainer"]),
});

export async function listUsers(tx: Tx, orgId: string) {
  return tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      inviteExpiresAt: sql<string | null>`(select max(expires_at)::text from invitations iv where iv.user_id = ${Q.userId} and iv.accepted_at is null and iv.revoked_at is null)`,
    })
    .from(users)
    .where(eq(users.organizationId, orgId))
    .orderBy(asc(users.name));
}

export async function listAssignableUsers(tx: Tx, orgId: string) {
  return tx
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.organizationId, orgId), eq(users.status, "active")))
    .orderBy(asc(users.name));
}

async function issueInvitation(tx: Tx, orgId: string, userId: string, email: string, role: "org_admin" | "trainer", invitedBy: string | null) {
  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.userId, userId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const token = newToken();
  await tx.insert(invitations).values({
    organizationId: orgId,
    userId,
    email,
    role,
    tokenHash: sha256(token),
    invitedBy,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
  });
  return `${appUrl()}/invite/${token}`;
}

export async function inviteUser(tx: Tx, ctx: Ctx, raw: unknown) {
  if (!ctx.can("users.manage")) throw new ForbiddenError();
  const v = inviteSchema.parse(raw);
  const existing = await tx.execute<{ id: string }>(
    sql`select id from users where lower(email) = ${v.email} limit 1`,
  );
  if (existing.rows.length) {
    throw new AppError("Email already in use", "A user with this email already exists.", "duplicate");
  }
  const [user] = await tx
    .insert(users)
    .values({ organizationId: ctx.orgId, email: v.email, name: v.name, role: v.role, status: "invited" })
    .returning();
  const inviteUrl = await issueInvitation(tx, ctx.orgId, user.id, v.email, v.role, ctx.user.id);
  await audit(tx, {
    organizationId: ctx.orgId,
    actorId: ctx.user.id,
    action: "user_invite",
    entityType: "user",
    entityId: user.id,
    entityLabel: `${v.name} <${v.email}>`,
    next: { role: ROLE_LABEL[v.role] },
  });
  return { user, inviteUrl };
}

export async function resendInvitation(tx: Tx, ctx: Ctx, userId: string) {
  if (!ctx.can("users.manage")) throw new ForbiddenError();
  const user = await getOrgUser(tx, ctx.orgId, userId);
  if (user.status !== "invited") throw new AppError("Already active", "This user has already accepted the invitation.", "state");
  const inviteUrl = await issueInvitation(tx, ctx.orgId, user.id, user.email, user.role as "org_admin" | "trainer", ctx.user.id);
  await audit(tx, {
    organizationId: ctx.orgId,
    actorId: ctx.user.id,
    action: "user_invite",
    entityType: "user",
    entityId: user.id,
    entityLabel: `${user.name} <${user.email}>`,
    next: { resent: true },
  });
  return { user, inviteUrl };
}

async function getOrgUser(tx: Tx, orgId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new NotFoundError("user");
  const [u] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, orgId)));
  if (!u) throw new NotFoundError("user");
  return u;
}

async function assertNotLastAdmin(tx: Tx, orgId: string, userId: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.organizationId, orgId), eq(users.role, "org_admin"), eq(users.status, "active"), ne(users.id, userId)));
  if (Number(n) === 0) {
    throw new AppError("Last administrator", "An organization needs at least one active Organization Admin.", "last_admin");
  }
}

export async function updateUser(
  tx: Tx,
  ctx: Ctx,
  userId: string,
  input: { role?: "org_admin" | "trainer"; status?: "active" | "deactivated"; name?: string },
) {
  if (!ctx.can("users.manage")) throw new ForbiddenError();
  const user = await getOrgUser(tx, ctx.orgId, userId);
  if (userId === ctx.user.id && (input.status === "deactivated" || (input.role && input.role !== user.role))) {
    throw new AppError("Not allowed", "You cannot change your own role or deactivate yourself.", "self");
  }
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.role && input.role !== user.role) {
    if (user.role === "org_admin") await assertNotLastAdmin(tx, ctx.orgId, userId);
    patch.role = input.role;
  }
  if (input.status && input.status !== user.status) {
    if (input.status === "deactivated") {
      if (user.role === "org_admin") await assertNotLastAdmin(tx, ctx.orgId, userId);
      patch.status = "deactivated";
      patch.deactivatedAt = new Date();
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.userId, userId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    } else {
      patch.status = user.passwordHash ? "active" : "invited";
      patch.deactivatedAt = null;
    }
  }
  if (input.name?.trim()) patch.name = input.name.trim().slice(0, 120);
  await tx.update(users).set(patch).where(eq(users.id, userId));
  await audit(tx, {
    organizationId: ctx.orgId,
    actorId: ctx.user.id,
    action: "user_change",
    entityType: "user",
    entityId: userId,
    entityLabel: `${user.name} <${user.email}>`,
    previous: { role: ROLE_LABEL[user.role], status: user.status },
    next: { role: patch.role ? ROLE_LABEL[patch.role] : ROLE_LABEL[user.role], status: patch.status ?? user.status },
  });
}
