import type { Tx } from "@/db/tenant";
import { auditLogs, statusHistory } from "@/db/schema";

export type AuditAction =
  | "create"
  | "edit"
  | "archive"
  | "restore"
  | "assignment"
  | "unassignment"
  | "location_change"
  | "status_change"
  | "inspection"
  | "checkout"
  | "return"
  | "consumable_adjustment"
  | "consumable_allocation"
  | "reservation"
  | "reservation_cancel"
  | "user_invite"
  | "user_change"
  | "organization_change"
  | "attachment"
  | "qr"
  | "login";

export async function audit(
  tx: Tx,
  entry: {
    organizationId: string | null;
    actorId: string | null;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    entityLabel?: string | null;
    previous?: unknown;
    next?: unknown;
    reason?: string | null;
  },
) {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    entityLabel: entry.entityLabel ?? null,
    previous: (entry.previous ?? null) as object | null,
    next: (entry.next ?? null) as object | null,
    reason: entry.reason ?? null,
  });
}

export async function recordStatusChange(
  tx: Tx,
  entry: {
    organizationId: string;
    itemId: string;
    previous: "available" | "needs_inspection" | "missing" | "rejected" | null;
    next: "available" | "needs_inspection" | "missing" | "rejected";
    reason?: string | null;
    source: string;
    userId: string | null;
  },
) {
  if (entry.previous === entry.next) return;
  await tx.insert(statusHistory).values({
    organizationId: entry.organizationId,
    inventoryItemId: entry.itemId,
    previousStatus: entry.previous,
    newStatus: entry.next,
    reason: entry.reason ?? null,
    source: entry.source,
    changedBy: entry.userId,
  });
}
