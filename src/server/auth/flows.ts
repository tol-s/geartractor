import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { withSystem } from "@/db";
import { invitations, organizations, passwordResetTokens, sessions, users } from "@/db/schema";
import { AppError } from "../errors";
import { audit } from "../audit";
import { appUrl } from "../qr";
import { sendEmail } from "../email";
import { enforceRateLimit } from "./rate-limit";
import { hashPassword, newToken, sha256, validatePasswordStrength, verifyPassword } from "./password";

const GENERIC_LOGIN_ERROR = new AppError(
  "Unable to sign in",
  "The email or password is incorrect, or the account is not active.",
  "invalid_credentials",
);

export async function authenticate(emailRaw: string, password: string, ip: string) {
  const email = emailRaw.trim().toLowerCase();
  return withSystem(async (tx) => {
    await enforceRateLimit(tx, `login:ip:${ip}`, 30, 15 * 60);
    await enforceRateLimit(tx, `login:email:${email}`, 10, 15 * 60);
    const [row] = await tx
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        role: users.role,
        organizationId: users.organizationId,
        orgStatus: organizations.status,
      })
      .from(users)
      .leftJoin(organizations, eq(organizations.id, users.organizationId))
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    const ok = await verifyPassword(password, row?.passwordHash);
    if (!row || !ok || row.status !== "active") throw GENERIC_LOGIN_ERROR;
    if (row.role !== "super_admin" && row.orgStatus !== "active") {
      throw new AppError("Organization inactive", "Your organization has been deactivated. Contact your administrator.", "org_inactive");
    }
    await tx.execute(sql`delete from rate_limits where key = ${`login:email:${email}`}`);
    await audit(tx, {
      organizationId: row.organizationId,
      actorId: row.id,
      action: "login",
      entityType: "user",
      entityId: row.id,
    });
    return { userId: row.id, role: row.role, organizationId: row.organizationId };
  });
}

export async function requestPasswordReset(emailRaw: string, ip: string) {
  const email = emailRaw.trim().toLowerCase();
  const result = await withSystem(async (tx) => {
    await enforceRateLimit(tx, `reset:ip:${ip}`, 10, 15 * 60);
    await enforceRateLimit(tx, `reset:email:${email}`, 3, 15 * 60);
    const [user] = await tx
      .select({ id: users.id, name: users.name, status: users.status })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (!user || user.status !== "active") return null;
    const token = newToken();
    await tx.insert(passwordResetTokens).values({
      id: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return { url: `${appUrl()}/reset-password?token=${token}`, name: user.name };
  });
  if (result) {
    await sendEmail({
      to: email,
      subject: "Reset your Gear Tractor password",
      text: `Hi ${result.name},\n\nUse this link to reset your password (valid for 1 hour):\n${result.url}\n\nIf you did not request this, you can ignore this email.`,
    });
  }
  // Always the same response to avoid account enumeration.
  return { ok: true };
}

export async function checkResetToken(token: string) {
  if (!token || token.length > 200) return false;
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.id, sha256(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, sql`now()`)));
    return Boolean(row);
  });
}

export async function resetPassword(token: string, password: string) {
  const weak = validatePasswordStrength(password);
  if (weak) throw new AppError("Choose a stronger password", weak, "validation");
  const hash = await hashPassword(password);
  return withSystem(async (tx) => {
    const [row] = await tx
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.id, sha256(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, sql`now()`)))
      .for("update");
    if (!row) throw new AppError("Link expired", "This reset link is invalid or has expired. Request a new one.", "expired");
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    const [user] = await tx
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.id, row.userId))
      .returning({ id: users.id, organizationId: users.organizationId });
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await audit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "user_change",
      entityType: "user",
      entityId: user.id,
      next: { passwordReset: true },
    });
    return { userId: user.id };
  });
}

export async function getInvitation(token: string) {
  if (!token || token.length > 200) return null;
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        userName: users.name,
        userStatus: users.status,
        orgName: organizations.name,
        orgLogo: organizations.logoDataUrl,
        orgColor: organizations.primaryColor,
      })
      .from(invitations)
      .innerJoin(users, eq(users.id, invitations.userId))
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(eq(invitations.tokenHash, sha256(token)));
    if (!row) return null;
    const valid = !row.acceptedAt && !row.revokedAt && row.expiresAt > new Date() && row.userStatus === "invited";
    return { ...row, valid };
  });
}

/** First-time password setup for an invited user. */
export async function acceptInvitation(token: string, name: string, password: string) {
  const weak = validatePasswordStrength(password);
  if (weak) throw new AppError("Choose a stronger password", weak, "validation");
  const hash = await hashPassword(password);
  return withSystem(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, sha256(token)))
      .for("update");
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) {
      throw new AppError("Invitation expired", "This invitation is invalid or has expired. Ask your administrator for a new one.", "expired");
    }
    const [user] = await tx.select().from(users).where(eq(users.id, inv.userId)).for("update");
    if (!user || user.status !== "invited") {
      throw new AppError("Invitation used", "This invitation has already been used.", "expired");
    }
    await tx
      .update(users)
      .set({ passwordHash: hash, status: "active", name: name.trim().slice(0, 120) || user.name, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await audit(tx, {
      organizationId: inv.organizationId,
      actorId: user.id,
      action: "user_change",
      entityType: "user",
      entityId: user.id,
      entityLabel: `${user.name} <${user.email}>`,
      next: { invitationAccepted: true },
    });
    return { userId: user.id, organizationId: inv.organizationId };
  });
}

export async function changePassword(userId: string, current: string, next: string) {
  const weak = validatePasswordStrength(next);
  if (weak) throw new AppError("Choose a stronger password", weak, "validation");
  const hash = await hashPassword(next);
  await withSystem(async (tx) => {
    await enforceRateLimit(tx, `pwchange:${userId}`, 5, 15 * 60);
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user || !(await verifyPassword(current, user.passwordHash))) {
      throw new AppError("Incorrect password", "Your current password is incorrect.", "invalid_credentials");
    }
    await tx.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, userId));
    await audit(tx, {
      organizationId: user.organizationId,
      actorId: userId,
      action: "user_change",
      entityType: "user",
      entityId: userId,
      next: { passwordChanged: true },
    });
  });
}
