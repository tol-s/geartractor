"use server";

import { withTenant } from "@/db";
import { actionContext } from "@/server/auth/context";
import { runAction } from "@/server/errors";
import type { InventoryInput } from "@/lib/validators";
import type { ItemStatus } from "@/lib/domain";
import {
  addKitContent,
  allocateConsumable,
  archiveInventoryItem,
  assignChild,
  createInventoryItem,
  getInventoryDetail,
  listAssignmentCandidates,
  releaseAllocation,
  removeKitContent,
  replenishAllocation,
  restoreInventoryItem,
  setItemStatus,
  unassignChild,
  updateInventoryItem,
} from "@/server/inventory";
import { manualStockChange } from "@/server/consumables";
import { resolveScan } from "@/server/qr";
import { findActiveCheckoutForItem } from "@/server/checkout";
import { AppError } from "@/server/errors";

export async function createInventoryAction(input: InventoryInput) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    const item = await withTenant(ctx.orgId, (tx) => createInventoryItem(tx, ctx, input));
    return { id: item.id, code: item.code };
  });
}

export async function updateInventoryAction(id: string, input: InventoryInput) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => updateInventoryItem(tx, ctx, id, input));
    return { id };
  });
}

export async function setStatusAction(id: string, status: ItemStatus, reason: string) {
  return runAction(async () => {
    const ctx = await actionContext();
    // Trainers may report an issue (flag for inspection); other status changes require admin rights.
    const permitted =
      ctx.can("inventory.manage") || (status === "needs_inspection" && ctx.can("inspection.report_issue"));
    if (!permitted) throw new AppError("Not allowed", "You do not have permission to change this status.", "forbidden");
    await withTenant(ctx.orgId, (tx) => setItemStatus(tx, ctx, id, status, reason, ctx.can("inventory.manage") ? "user" : "report"));
  });
}

export async function archiveInventoryAction(id: string, reason: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => archiveInventoryItem(tx, ctx, id, reason));
  });
}

export async function restoreInventoryAction(id: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => restoreInventoryItem(tx, ctx, id));
  });
}

export async function assignmentCandidatesAction(parentId: string, q: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    return withTenant(ctx.orgId, (tx) => listAssignmentCandidates(tx, ctx.orgId, parentId, q));
  });
}

export async function assignChildAction(parentId: string, childId: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => assignChild(tx, ctx, parentId, childId));
  });
}

export async function assignByScanAction(parentId: string, scan: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    return withTenant(ctx.orgId, async (tx) => {
      const id = await resolveScan(tx, ctx.orgId, scan);
      if (!id) throw new AppError("Code not recognised", "This code does not match any equipment in your organization.", "not_found");
      await assignChild(tx, ctx, parentId, id);
      return { id };
    });
  });
}

export async function unassignChildAction(parentId: string, childId: string, reason?: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => unassignChild(tx, ctx, parentId, childId, reason));
  });
}

export async function allocateConsumableAction(parentId: string, consumableId: string, quantity: number) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => allocateConsumable(tx, ctx, parentId, consumableId, Number(quantity)));
  });
}

export async function releaseAllocationAction(allocationId: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => releaseAllocation(tx, ctx, allocationId));
  });
}

export async function replenishAllocationAction(allocationId: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => replenishAllocation(tx, ctx, allocationId));
  });
}

export async function addKitContentAction(kitId: string, description: string, quantity: string | null) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => addKitContent(tx, ctx, kitId, description, quantity));
  });
}

export async function removeKitContentAction(contentId: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    await withTenant(ctx.orgId, (tx) => removeKitContent(tx, ctx, contentId));
  });
}

export async function stockChangeAction(consumableId: string, input: { type: "receive" | "adjustment"; quantity: number; reason: string }) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.manage");
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity === 0 || (input.type === "receive" && quantity < 0)) {
      throw new AppError("Invalid quantity", "Enter a valid quantity.", "validation");
    }
    await withTenant(ctx.orgId, (tx) => manualStockChange(tx, ctx, consumableId, { ...input, quantity }));
  });
}

/** Resolves a scanned QR/ID to an inventory item in the caller's organization. */
export async function resolveScanAction(scan: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.view");
    const id = await withTenant(ctx.orgId, (tx) => resolveScan(tx, ctx.orgId, scan));
    if (!id) throw new AppError("Code not recognised", "This QR code does not match any equipment in your organization.", "not_found");
    return { id };
  });
}

/** Scan lookup for the mobile scanner: summary + which actions apply. */
export async function scanLookupAction(scan: string) {
  return runAction(async () => {
    const ctx = await actionContext("inventory.view");
    return withTenant(ctx.orgId, async (tx) => {
      const id = await resolveScan(tx, ctx.orgId, scan);
      if (!id) throw new AppError("Code not recognised", "This QR code does not match any equipment in your organization.", "not_found");
      const d = await getInventoryDetail(tx, ctx.orgId, id);
      const active = await findActiveCheckoutForItem(tx, ctx, id);
      return {
        id: d.item.id,
        code: d.item.code,
        name: d.item.name,
        kind: d.item.kind,
        status: d.item.effectiveStatus,
        reasons: d.item.statusReasons.map((r) => r.label),
        checkoutBlocked: d.item.checkoutBlocked,
        locationName: d.locationName,
        techSpec: d.item.techSpec,
        ancestors: d.ancestors,
        checkedOutCode: d.checkedOutCode,
        activeCheckout: active,
        contents: d.descendants.length,
        stockUnallocated: d.stockUnallocated,
        unit: d.item.quantityUnit,
        canInspect: ctx.can("inspection.perform"),
      };
    });
  });
}
