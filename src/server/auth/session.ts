import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { withSystem } from "@/db";
import { organizations, sessions, users } from "@/db/schema";
import { newToken, sha256 } from "./password";

export const SESSION_COOKIE = "gt_session";
const LONG_SESSION_DAYS = 30;
const SHORT_SESSION_HOURS = 12;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "org_admin" | "trainer";
  organizationId: string | null;
  phone: string | null;
  notifyEmail: boolean;
  notifyOverdue: boolean;
  notifyInspections: boolean;
};

export type CurrentSession = {
  sessionId: string;
  user: SessionUser;
  activeOrganizationId: string | null;
};

export async function createSession(userId: string, remember: boolean, activeOrganizationId: string | null) {
  const token = newToken();
  const id = sha256(token);
  const expiresAt = remember
    ? new Date(Date.now() + LONG_SESSION_DAYS * 86400_000)
    : new Date(Date.now() + SHORT_SESSION_HOURS * 3600_000);
  const h = await headers();
  await withSystem(async (tx) => {
    await tx.insert(sessions).values({
      id,
      userId,
      expiresAt,
      activeOrganizationId,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
    });
    await tx.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId));
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(remember ? { expires: expiresAt } : {}),
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await withSystem((tx) => tx.delete(sessions).where(eq(sessions.id, sha256(token))));
  }
  jar.delete(SESSION_COOKIE);
}

/** Reads and validates the session cookie. Cached per request. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const id = sha256(token);
  return withSystem(async (tx) => {
    const rows = await tx
      .select({
        sessionId: sessions.id,
        activeOrganizationId: sessions.activeOrganizationId,
        lastSeenAt: sessions.lastSeenAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          organizationId: users.organizationId,
          status: users.status,
          phone: users.phone,
          notifyEmail: users.notifyEmail,
          notifyOverdue: users.notifyOverdue,
          notifyInspections: users.notifyInspections,
        },
        orgStatus: organizations.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(organizations, eq(organizations.id, users.organizationId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, sql`now()`)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.user.status !== "active") return null;
    if (row.user.role !== "super_admin" && row.orgStatus !== "active") return null;

    // Throttled activity tracking.
    if (Date.now() - new Date(row.lastSeenAt).getTime() > 5 * 60_000) {
      await tx.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
      await tx.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, row.user.id));
    }
    const { status: _status, ...user } = row.user;
    void _status;
    return {
      sessionId: row.sessionId,
      activeOrganizationId: row.activeOrganizationId,
      user,
    };
  });
});

export async function setActiveOrganization(sessionId: string, organizationId: string | null) {
  await withSystem((tx) =>
    tx.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.id, sessionId)),
  );
}

export async function revokeUserSessions(userId: string) {
  await withSystem((tx) => tx.delete(sessions).where(eq(sessions.userId, userId)));
}
