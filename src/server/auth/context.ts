import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withSystem } from "@/db";
import { organizations, type OrgSettings } from "@/db/schema";
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

/**
 * Resolves the organization context from the authenticated session only.
 * The organization id is never accepted from the client.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  const isSuperAdmin = session.user.role === "super_admin";
  const orgId = isSuperAdmin ? session.activeOrganizationId : session.user.organizationId;
  if (!orgId) return null;
  const org = await loadOrg(orgId);
  if (!org) return null;
  if (org.status !== "active" && !isSuperAdmin) return null;
  const role: Role = isSuperAdmin ? "org_admin" : session.user.role;
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
