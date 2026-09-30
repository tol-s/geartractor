"use server";

import { redirect } from "next/navigation";
import { destroySession, getCurrentSession, setActiveOrganization } from "@/server/auth/session";
import { withSystem } from "@/db";
import { getOrganization } from "@/server/organizations";
import { audit } from "@/server/audit";
import { runAction } from "@/server/errors";
import { ForbiddenError } from "@/server/errors";

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
