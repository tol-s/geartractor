import { and, eq, isNull, sql } from "drizzle-orm";
import { Q } from "@/db/columns";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { invitations, organizationMembers, sessions, users } from "@/db/schema";
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
  const home = await tx
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
    .where(eq(users.organizationId, orgId));
  // People whose home is another organization but who were added here.
  const members = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: organizationMembers.role,
      status: sql<"active" | "invited" | "deactivated">`case when ${users.status} = 'active' then ${organizationMembers.status} else ${users.status} end`,
      lastActiveAt: users.lastActiveAt,
      createdAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, orgId));
  return [
    ...home.map((u) => ({ ...u, member: false })),
    ...members.map((u) => ({ ...u, inviteExpiresAt: null, member: true })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAssignableUsers(tx: Tx, orgId: string) {
  const all = await listUsers(tx, orgId);
  return all.filter((u) => u.status === "active").map(({ id, name, email, role }) => ({ id, name, email, role }));
}

/** True when the user can act inside the organization (home user or active member). */
export async function isActiveOrgUser(tx: Tx, orgId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const res = await tx.execute<{ ok: boolean }>(sql`
    select exists (select 1 from users where id = ${userId} and organization_id = ${orgId} and status = 'active')
        or exists (select 1 from organization_members m join users u on u.id = m.user_id
                   where m.user_id = ${userId} and m.organization_id = ${orgId} and m.status = 'active' and u.status = 'active') as ok`);
  return Boolean(res.rows[0]?.ok);
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
  // Users of other organizations are hidden by RLS, so look the email up by its own policy-free function.
  const existing = await tx.execute<{ id: string; organization_id: string | null; role: string; name: string; email: string }>(
    sql`select * from gt_find_user_by_email(${v.email})`,
  );
  const found = existing.rows[0];
  if (found) {
    if (found.role === "super_admin" || found.organization_id === ctx.orgId) {
      throw new AppError("Email already in use", "A user with this email already exists.", "duplicate");
    }
    const [already] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, ctx.orgId), eq(organizationMembers.userId, found.id)));
    if (already) throw new AppError("Already a member", "This person already has access to this organization.", "duplicate");
    await tx.insert(organizationMembers).values({ organizationId: ctx.orgId, userId: found.id, role: v.role, invitedBy: ctx.user.id });
    await audit(tx, {
      organizationId: ctx.orgId,
      actorId: ctx.user.id,
      action: "user_invite",
      entityType: "user",
      entityId: found.id,
      entityLabel: `${found.name} <${found.email}>`,
      next: { role: ROLE_LABEL[v.role], addedExistingAccount: true },
    });
    return { user: { id: found.id, name: found.name, email: found.email, role: v.role }, inviteUrl: null };
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
  if (u) return { ...u, membershipId: null as string | null };
  const [m] = await tx
    .select({ user: users, membershipId: organizationMembers.id, role: organizationMembers.role, status: organizationMembers.status })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, orgId)));
  if (!m) throw new NotFoundError("user");
  return { ...m.user, role: m.role, status: m.status, membershipId: m.membershipId as string | null };
}

async function assertNotLastAdmin(tx: Tx, orgId: string, userId: string) {
  const res = await tx.execute<{ n: number }>(sql`
    select (select count(*) from users where organization_id = ${orgId} and role = 'org_admin' and status = 'active' and id <> ${userId})
         + (select count(*) from organization_members m join users u on u.id = m.user_id
            where m.organization_id = ${orgId} and m.role = 'org_admin' and m.status = 'active' and u.status = 'active' and m.user_id <> ${userId}) as n`);
  if (Number(res.rows[0]?.n ?? 0) === 0) {
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
  if (user.membershipId) {
    // Access granted to someone from another organization: only the membership changes here.
    const mpatch: Partial<typeof organizationMembers.$inferInsert> = { updatedAt: new Date() };
    if (input.role && input.role !== user.role) {
      if (user.role === "org_admin") await assertNotLastAdmin(tx, ctx.orgId, userId);
      mpatch.role = input.role;
    }
    if (input.status && input.status !== user.status) {
      if (input.status === "deactivated" && user.role === "org_admin") await assertNotLastAdmin(tx, ctx.orgId, userId);
      mpatch.status = input.status;
    }
    await tx.update(organizationMembers).set(mpatch).where(eq(organizationMembers.id, user.membershipId));
    await audit(tx, {
      organizationId: ctx.orgId,
      actorId: ctx.user.id,
      action: "user_change",
      entityType: "user",
      entityId: userId,
      entityLabel: `${user.name} <${user.email}>`,
      previous: { role: ROLE_LABEL[user.role], status: user.status },
      next: { role: ROLE_LABEL[mpatch.role ?? user.role], status: mpatch.status ?? user.status },
    });
    return;
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
