import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { consumableMovements, consumableStock, inventoryItems, users } from "@/db/schema";
import { formatQty } from "@/lib/utils";
import type { OrgContext } from "./auth/context";
import { AppError, NotFoundError } from "./errors";
import { audit } from "./audit";

type Actor = Pick<OrgContext, "orgId" | "user">;

/**
 * Consumable stock model (no automatic unit conversion):
 *   Total Remaining = everything still owned
 *   Allocated       = reserved into Configurations/Kits
 *   Issued          = directly issued on checkouts
 *   Unallocated     = Total - Allocated - Issued
 * Cumulative counters track Unused Return, Consumed, Loss and Adjustments.
 */
export type StockSnapshot = {
  totalQuantity: number;
  allocatedQuantity: number;
  issuedQuantity: number;
  unallocated: number;
};

export async function lockStock(tx: Tx, orgId: string, consumableId: string): Promise<StockSnapshot> {
  const [row] = await tx
    .select()
    .from(consumableStock)
    .where(and(eq(consumableStock.inventoryItemId, consumableId), eq(consumableStock.organizationId, orgId)))
    .for("update");
  if (!row) throw new NotFoundError("consumable stock");
  return {
    totalQuantity: row.totalQuantity,
    allocatedQuantity: row.allocatedQuantity,
    issuedQuantity: row.issuedQuantity,
    unallocated: round(row.totalQuantity - row.allocatedQuantity - row.issuedQuantity),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

type Movement =
  | { type: "receive"; delta: number }
  | { type: "adjustment"; delta: number }
  | { type: "allocate"; delta: number }
  | { type: "release"; delta: number }
  | { type: "issue"; delta: number }
  | { type: "return_unused"; delta: number; bucket?: "issued" | "allocated" }
  | { type: "consumed"; delta: number; bucket?: "issued" | "allocated" }
  | { type: "loss"; delta: number; bucket?: "issued" | "allocated" };

export async function adjustStock(
  tx: Tx,
  actor: Actor,
  consumableId: string,
  m: Movement & { note?: string | null; referenceType?: string; referenceId?: string },
) {
  const d = round(m.delta);
  if (m.type !== "adjustment" && !(d > 0)) {
    throw new AppError("Invalid quantity", "Quantity must be greater than zero.", "validation");
  }
  const s = consumableStock;
  let set: Record<string, unknown>;
  switch (m.type) {
    case "receive":
      set = { totalQuantity: sql`${s.totalQuantity} + ${d}` };
      break;
    case "adjustment":
      set = { totalQuantity: sql`${s.totalQuantity} + ${d}`, adjustmentsTotal: sql`${s.adjustmentsTotal} + ${d}` };
      break;
    case "allocate":
      set = { allocatedQuantity: sql`${s.allocatedQuantity} + ${d}` };
      break;
    case "release":
      set = { allocatedQuantity: sql`${s.allocatedQuantity} - ${d}` };
      break;
    case "issue":
      set = { issuedQuantity: sql`${s.issuedQuantity} + ${d}` };
      break;
    case "return_unused":
      set =
        m.bucket === "allocated"
          ? { unusedReturnedTotal: sql`${s.unusedReturnedTotal} + ${d}` }
          : { issuedQuantity: sql`${s.issuedQuantity} - ${d}`, unusedReturnedTotal: sql`${s.unusedReturnedTotal} + ${d}` };
      break;
    case "consumed":
      set = {
        ...(m.bucket === "allocated"
          ? { allocatedQuantity: sql`${s.allocatedQuantity} - ${d}` }
          : { issuedQuantity: sql`${s.issuedQuantity} - ${d}` }),
        totalQuantity: sql`${s.totalQuantity} - ${d}`,
        consumedTotal: sql`${s.consumedTotal} + ${d}`,
      };
      break;
    case "loss":
      set = {
        ...(m.bucket === "allocated"
          ? { allocatedQuantity: sql`${s.allocatedQuantity} - ${d}` }
          : { issuedQuantity: sql`${s.issuedQuantity} - ${d}` }),
        totalQuantity: sql`${s.totalQuantity} - ${d}`,
        lossTotal: sql`${s.lossTotal} + ${d}`,
      };
      break;
  }
  // Check constraints (non-negative, no over-allocation) are the final guard.
  const [row] = await tx
    .update(consumableStock)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(s.inventoryItemId, consumableId), eq(s.organizationId, actor.orgId)))
    .returning({ total: s.totalQuantity });
  if (!row) throw new NotFoundError("consumable stock");
  await tx.insert(consumableMovements).values({
    organizationId: actor.orgId,
    consumableItemId: consumableId,
    type: m.type,
    quantity: d,
    totalAfter: row.total,
    note: m.note ?? null,
    referenceType: m.referenceType ?? null,
    referenceId: m.referenceId ?? null,
    userId: actor.user.id,
  });
}

/** Manual stock receipt or adjustment by an admin (always audited with a reason). */
export async function manualStockChange(
  tx: Tx,
  actor: Actor,
  consumableId: string,
  input: { type: "receive" | "adjustment"; quantity: number; reason: string },
) {
  const [item] = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, consumableId), eq(inventoryItems.organizationId, actor.orgId)));
  if (!item || item.kind !== "consumable") throw new NotFoundError("consumable");
  if (!input.reason.trim()) throw new AppError("Reason required", "Enter a reason for this stock change.", "validation");
  const before = await lockStock(tx, actor.orgId, consumableId);
  if (input.type === "adjustment" && before.totalQuantity + input.quantity < before.allocatedQuantity + before.issuedQuantity) {
    throw new AppError(
      "Adjustment not possible",
      `Stock cannot drop below the allocated and issued quantity (${formatQty(before.allocatedQuantity + before.issuedQuantity, item.quantityUnit)}).`,
      "insufficient_stock",
    );
  }
  await adjustStock(tx, actor, consumableId, {
    type: input.type,
    delta: input.quantity,
    note: input.reason,
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "consumable_adjustment",
    entityType: "consumable",
    entityId: consumableId,
    entityLabel: `${item.code} ${item.name}`,
    previous: { total: formatQty(before.totalQuantity, item.quantityUnit) },
    next: { total: formatQty(before.totalQuantity + input.quantity, item.quantityUnit), change: input.quantity, type: input.type },
    reason: input.reason,
  });
}

export async function listMovements(tx: Tx, orgId: string, consumableId: string, limit = 50) {
  return tx
    .select({
      id: consumableMovements.id,
      type: consumableMovements.type,
      quantity: consumableMovements.quantity,
      totalAfter: consumableMovements.totalAfter,
      note: consumableMovements.note,
      createdAt: consumableMovements.createdAt,
      userName: users.name,
    })
    .from(consumableMovements)
    .leftJoin(users, eq(users.id, consumableMovements.userId))
    .where(and(eq(consumableMovements.organizationId, orgId), eq(consumableMovements.consumableItemId, consumableId)))
    .orderBy(desc(consumableMovements.createdAt))
    .limit(limit);
}
