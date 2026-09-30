import type { Role } from "@/lib/domain";
import type { OrgSettings } from "@/db/schema";

export const PERMISSIONS = [
  "inventory.view",
  "inventory.manage",
  "checkout.create",
  "checkout.assign_user",
  "checkout.manage_all",
  "reservation.create",
  "reservation.manage_all",
  "reservation.override",
  "inspection.perform",
  "inspection.report_issue",
  "locations.manage",
  "users.manage",
  "org.settings",
  "audit.view",
  "export.csv",
  "qr.generate",
  "attachments.manage",
  "attachments.view",
  "platform.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const TRAINER: Permission[] = [
  "inventory.view",
  "checkout.create",
  "reservation.create",
  "inspection.report_issue",
  "attachments.view",
];

const ORG_ADMIN: Permission[] = PERMISSIONS.filter((p) => p !== "platform.manage");

/**
 * Role-based permissions. Super admins act as organization admins when they enter an organization.
 * Organization settings can widen trainer permissions ("permitted inspection actions").
 */
export function permissionsFor(role: Role, settings: OrgSettings = {}): Set<Permission> {
  if (role === "super_admin") return new Set(PERMISSIONS);
  if (role === "org_admin") return new Set(ORG_ADMIN);
  const set = new Set(TRAINER);
  if (settings.trainersCanInspect) set.add("inspection.perform");
  return set;
}

export function hasPermission(role: Role, permission: Permission, settings: OrgSettings = {}): boolean {
  return permissionsFor(role, settings).has(permission);
}
