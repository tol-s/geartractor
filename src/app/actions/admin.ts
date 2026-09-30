"use server";

import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db";
import { users } from "@/db/schema";
import { actionContext, superAdminActionContext } from "@/server/auth/context";
import { getCurrentSession } from "@/server/auth/session";
import { AppError, ForbiddenError, runAction } from "@/server/errors";
import { createLocation, updateLocation } from "@/server/locations";
import { inviteUser, resendInvitation, updateUser } from "@/server/users";
import {
  createOrganization,
  setOrganizationStatus,
  updateOrganizationBranding,
  updateOrganizationSettings,
} from "@/server/organizations";
import { changePassword } from "@/server/auth/flows";
import { audit } from "@/server/audit";
import { sendEmail } from "@/server/email";
import { ROLE_LABEL } from "@/lib/domain";

export async function saveLocationAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await actionContext("locations.manage");
    return withTenant(ctx.orgId, async (tx) => {
      if (id) {
        await updateLocation(tx, ctx, id, input);
        return { id };
      }
      const row = await createLocation(tx, ctx, input);
      return { id: row.id };
    });
  });
}

export async function inviteUserAction(input: { name: string; email: string; role: "org_admin" | "trainer" }) {
  return runAction(async () => {
    const ctx = await actionContext("users.manage");
    const res = await withTenant(ctx.orgId, (tx) => inviteUser(tx, ctx, input));
    const mail = await sendEmail({
      to: res.user.email,
      subject: `You're invited to ${ctx.org.name} on Gear Tractor`,
      text: `Hi ${res.user.name},\n\n${ctx.user.name} invited you to ${ctx.org.name} as ${ROLE_LABEL[res.user.role]}.\nSet up your password here (valid for 7 days):\n${res.inviteUrl}`,
    });
    return { inviteUrl: res.inviteUrl, emailed: mail.delivered };
  });
}

export async function resendInviteAction(userId: string) {
  return runAction(async () => {
    const ctx = await actionContext("users.manage");
    const res = await withTenant(ctx.orgId, (tx) => resendInvitation(tx, ctx, userId));
    const mail = await sendEmail({
      to: res.user.email,
      subject: `Your invitation to ${ctx.org.name} on Gear Tractor`,
      text: `Hi ${res.user.name},\n\nSet up your password here (valid for 7 days):\n${res.inviteUrl}`,
    });
    return { inviteUrl: res.inviteUrl, emailed: mail.delivered };
  });
}

export async function updateUserAction(userId: string, input: { role?: "org_admin" | "trainer"; status?: "active" | "deactivated" }) {
  return runAction(async () => {
    const ctx = await actionContext("users.manage");
    await withTenant(ctx.orgId, (tx) => updateUser(tx, ctx, userId, input));
  });
}

export async function saveBrandingAction(input: unknown) {
  return runAction(async () => {
    const ctx = await actionContext("org.settings");
    await withSystem((tx) => updateOrganizationBranding(tx, ctx.user.id, ctx.orgId, input));
  });
}

export async function saveOrgSettingsAction(input: unknown) {
  return runAction(async () => {
    const ctx = await actionContext("org.settings");
    await withSystem((tx) => updateOrganizationSettings(tx, ctx.user.id, ctx.orgId, input));
  });
}

export async function updateProfileAction(input: { name: string; phone: string | null; notifyEmail: boolean; notifyOverdue: boolean; notifyInspections: boolean }) {
  return runAction(async () => {
    const session = await getCurrentSession();
    if (!session) throw new ForbiddenError("Your session has expired. Please sign in again.");
    const name = input.name.trim();
    if (!name) throw new AppError("Name required", "Enter your name.", "validation");
    await withSystem(async (tx) => {
      await tx
        .update(users)
        .set({
          name: name.slice(0, 120),
          phone: input.phone?.trim().slice(0, 60) || null,
          notifyEmail: Boolean(input.notifyEmail),
          notifyOverdue: Boolean(input.notifyOverdue),
          notifyInspections: Boolean(input.notifyInspections),
          updatedAt: new Date(),
        })
        .where(eq(users.id, session.user.id));
      await audit(tx, {
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        action: "user_change",
        entityType: "user",
        entityId: session.user.id,
        previous: { name: session.user.name },
        next: { name, profileUpdated: true },
      });
    });
  });
}

export async function changePasswordAction(current: string, next: string) {
  return runAction(async () => {
    const session = await getCurrentSession();
    if (!session) throw new ForbiddenError("Your session has expired. Please sign in again.");
    await changePassword(session.user.id, current, next);
  });
}

/* ---------------- Super admin ---------------- */

export async function createOrganizationAction(input: unknown) {
  return runAction(async () => {
    const session = await superAdminActionContext();
    const res = await withSystem((tx) => createOrganization(tx, session.user.id, input));
    const mail = await sendEmail({
      to: res.adminEmail,
      subject: `Your ${res.org.name} workspace on Gear Tractor`,
      text: `You have been invited as Organization Admin of ${res.org.name}.\nSet up your password here (valid for 7 days):\n${res.inviteUrl}`,
    });
    return { id: res.org.id, inviteUrl: res.inviteUrl, emailed: mail.delivered };
  });
}

export async function setOrganizationStatusAction(orgId: string, status: "active" | "inactive") {
  return runAction(async () => {
    const session = await superAdminActionContext();
    await withSystem((tx) => setOrganizationStatus(tx, session.user.id, orgId, status));
  });
}

export async function updateOrganizationAction(orgId: string, input: unknown) {
  return runAction(async () => {
    const session = await superAdminActionContext();
    await withSystem((tx) => updateOrganizationBranding(tx, session.user.id, orgId, input));
  });
}
