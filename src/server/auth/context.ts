import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { withSystem } from "@/db";
import { organizationMembers, organizations, type OrgSettings } from "@/db/schema";
import type { Role } from "@/lib/domain";
import { ForbiddenError } from "../errors";
import { getCurrentSession, type SessionUser } from "./session";
import { permissionsFor, type Permission } from "./permissions";

export type OrgBranding = {
  id: string;
  name: string;
  slug: string;
  logoDataUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  timezone: string;
  settings: OrgSettings;
};

export type OrgContext = {
  sessionId: string;
  user: SessionUser;
  orgId: string;
  org: OrgBranding;
  /** Role used for authorization inside the organization. */
  role: Role;
  isSuperAdmin: boolean;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
};

const loadOrg = cache(async (orgId: string): Promise<(OrgBranding & { status: string }) | null> => {
  const rows = await withSystem((tx) =>
    tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        status: organizations.status,
        logoDataUrl: organizations.logoDataUrl,
        primaryColor: organizations.primaryColor,
        secondaryColor: organizations.secondaryColor,
        accentColor: organizations.accentColor,
        timezone: organizations.timezone,
        settings: organizations.settings,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1),
  );
  return rows[0] ?? null;
});

const loadMembership = cache(async (userId: string, orgId: string) => {
  const rows = await withSystem((tx) =>
    tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.status, "active"),
          eq(organizations.status, "active"),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
});

export type OrgChoice = {
  id: string;
  name: string;
  logo: string | null;
  color: string;
  role: Role;
  status: "active" | "inactive";
};

/**
 * Organizations the signed-in user can switch between: their home organization plus active
 * memberships. Platform admins see every organization.
 */
export async function listOrgChoices(ctx: Pick<OrgContext, "user" | "isSuperAdmin">): Promise<OrgChoice[]> {
  return withSystem(async (tx) => {
    const cols = {
      id: organizations.id,
      name: organizations.name,
      logo: organizations.logoDataUrl,
      color: organizations.primaryColor,
      status: organizations.status,
    };
    if (ctx.isSuperAdmin) {
      const rows = await tx.select(cols).from(organizations).orderBy(asc(organizations.name));
      return rows.map((r) => ({ ...r, role: "super_admin" as Role }));
    }
    const home = ctx.user.organizationId
      ? await tx.select(cols).from(organizations).where(eq(organizations.id, ctx.user.organizationId))
      : [];
    const extra = await tx
      .select({ ...cols, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.userId, ctx.user.id),
          eq(organizationMembers.status, "active"),
          eq(organizations.status, "active"),
          ctx.user.organizationId ? ne(organizations.id, ctx.user.organizationId) : undefined,
        ),
      )
      .orderBy(asc(organizations.name));
    return [...home.map((r) => ({ ...r, role: ctx.user.role })), ...extra];
  });
}

/**
 * Resolves the organization context from the authenticated session only.
 * The organization id is never accepted from the client.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  const isSuperAdmin = session.user.role === "super_admin";
  let orgId = isSuperAdmin ? session.activeOrganizationId : session.user.organizationId;
  let role: Role = isSuperAdmin ? "org_admin" : session.user.role;
  // A member of several organizations works in the one selected in their session. The membership
  // is re-checked on every request, so revoked access falls back to the home organization.
  if (!isSuperAdmin && session.activeOrganizationId && session.activeOrganizationId !== orgId) {
    const membership = await loadMembership(session.user.id, session.activeOrganizationId);
    if (membership) {
      orgId = session.activeOrganizationId;
      role = membership.role;
    }
  }
  if (!orgId) return null;
  const org = await loadOrg(orgId);
  if (!org) return null;
  if (org.status !== "active" && !isSuperAdmin) return null;
  const permissions = permissionsFor(role, org.settings);
  const { status: _s, ...branding } = org;
  void _s;
  return {
    sessionId: session.sessionId,
    user: session.user,
    orgId,
    org: branding,
    role,
    isSuperAdmin,
    permissions,
    can: (p) => permissions.has(p),
  };
});

/** For pages: redirects to login / organization picker when there is no tenant context. */
export async function requireOrgContext(permission?: Permission): Promise<OrgContext> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const ctx = await getOrgContext();
  if (!ctx) {
    if (session.user.role === "super_admin") redirect("/admin/organizations");
    redirect("/login");
  }
  if (permission && !ctx.can(permission)) redirect("/dashboard?denied=1");
  return ctx;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function actionContext(permission?: Permission): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new ForbiddenError("Your session has expired. Please sign in again.");
  if (permission && !ctx.can(permission)) throw new ForbiddenError();
  return ctx;
}

export function assertCan(ctx: OrgContext, permission: Permission) {
  if (!ctx.can(permission)) throw new ForbiddenError();
}

export async function requireSuperAdmin() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin") redirect("/dashboard");
  return session;
}

export async function superAdminActionContext() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "super_admin") throw new ForbiddenError();
  return session;
}
