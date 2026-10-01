"use server";

import { redirect } from "next/navigation";
import { destroySession, getCurrentSession, setActiveOrganization } from "@/server/auth/session";
import { withSystem } from "@/db";
import { getOrganization } from "@/server/organizations";
import { audit } from "@/server/audit";
import { runAction, type ActionResult } from "@/server/errors";
import { PLATFORM_ORG_ID } from "@/components/shell/platform";
import { ForbiddenError } from "@/server/errors";
import { listOrgChoices } from "@/server/auth/context";

export async function signOutAction() {
  await destroySession();
  redirect("/login");
}

/** Super admin: enter an organization's environment (authorised, audited). */
export async function enterOrganizationAction(organizationId: string) {
  const result = await runAction(async () => {
    const session = await getCurrentSession();
    if (!session || session.user.role !== "super_admin") throw new ForbiddenError();
    await withSystem(async (tx) => {
      const org = await getOrganization(tx, organizationId);
      await audit(tx, {
        organizationId: org.id,
        actorId: session.user.id,
        action: "organization_change",
        entityType: "organization",
        entityId: org.id,
        entityLabel: org.name,
        next: { platformAdminEntered: true },
      });
    });
    await setActiveOrganization(session.sessionId, organizationId);
  });
  if (result.ok) redirect("/dashboard");
  return result;
}

export async function leaveOrganizationAction() {
  const session = await getCurrentSession();
  if (session?.user.role === "super_admin") {
    await setActiveOrganization(session.sessionId, null);
    redirect("/admin/organizations");
  }
  redirect("/dashboard");
}

/**
 * Switch the active organization from the organization switcher. Access is verified server-side.
 * The client does a full page load afterwards so nothing cached from the previous tenant survives.
 */
export async function switchOrganizationAction(organizationId: string): Promise<ActionResult<{ href: string }>> {
  return runAction(async () => {
    const session = await getCurrentSession();
    if (!session) throw new ForbiddenError("Your session has expired. Please sign in again.");
    const isSuperAdmin = session.user.role === "super_admin";
    if (isSuperAdmin && organizationId === PLATFORM_ORG_ID) {
      await setActiveOrganization(session.sessionId, null);
      return { href: "/admin/organizations" };
    }
    const choices = await listOrgChoices({ user: session.user, isSuperAdmin });
    if (!choices.some((o) => o.id === organizationId)) throw new ForbiddenError("You don't have access to that organization.");
    if (isSuperAdmin) {
      await withSystem((tx) =>
        audit(tx, {
          organizationId,
          actorId: session.user.id,
          action: "organization_change",
          entityType: "organization",
          entityId: organizationId,
          entityLabel: choices.find((o) => o.id === organizationId)?.name ?? null,
          next: { platformAdminEntered: true },
        }),
      );
    }
    await setActiveOrganization(session.sessionId, !isSuperAdmin && organizationId === session.user.organizationId ? null : organizationId);
    return { href: "/dashboard" };
  });
}
