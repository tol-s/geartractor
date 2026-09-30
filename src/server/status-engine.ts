import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { assignments, consumableAllocations, inventoryItems, organizations } from "@/db/schema";
import { computeStatuses, type StatusInputItem } from "@/lib/status-rules";
import { isoDateInZone } from "@/lib/utils";
import { recordStatusChange } from "./audit";

export async function orgToday(tx: Tx, organizationId: string): Promise<string> {
  const [org] = await tx
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return isoDateInZone(new Date(), org?.timezone ?? "UTC");
}

/**
 * Recomputes derived status for the whole organization inside the current transaction.
 * An advisory lock serializes recomputation per tenant so concurrent writers never
 * persist a stale view of the hierarchy.
 */
export async function recomputeOrgStatuses(
  tx: Tx,
  organizationId: string,
  opts: { actorId?: string | null; source?: string } = {},
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"status:" + organizationId}, 0))`);
  const today = await orgToday(tx, organizationId);

  const rows = await tx
    .select({
      id: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      status: inventoryItems.status,
      lifespanMode: inventoryItems.lifespanMode,
      lifespanMonths: inventoryItems.lifespanMonths,
      expiryBasis: inventoryItems.expiryBasis,
      manufactureDate: inventoryItems.manufactureDate,
      firstUseDate: inventoryItems.firstUseDate,
      explicitExpiry: inventoryItems.explicitExpiry,
      annualInspectionRequired: inventoryItems.annualInspectionRequired,
      nextInspectionDate: inventoryItems.nextInspectionDate,
      computedExpiry: inventoryItems.computedExpiry,
      effectiveStatus: inventoryItems.effectiveStatus,
      statusReasons: inventoryItems.statusReasons,
      checkoutBlocked: inventoryItems.checkoutBlocked,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, organizationId), isNull(inventoryItems.archivedAt)));

  const links = await tx
    .select({ parentId: assignments.parentItemId, childId: assignments.childItemId })
    .from(assignments)
    .where(and(eq(assignments.organizationId, organizationId), isNull(assignments.unassignedAt)));

  const allocs = await tx
    .select({
      parentId: consumableAllocations.parentItemId,
      consumableId: consumableAllocations.consumableItemId,
      required: consumableAllocations.requiredQuantity,
      allocated: consumableAllocations.allocatedQuantity,
    })
    .from(consumableAllocations)
    .where(
      and(eq(consumableAllocations.organizationId, organizationId), isNull(consumableAllocations.releasedAt)),
    );

  const children = new Map<string, string[]>();
  for (const l of links) {
    const list = children.get(l.parentId) ?? [];
    list.push(l.childId);
    children.set(l.parentId, list);
  }

  const results = computeStatuses(rows as StatusInputItem[], children, allocs, today);

  const changed: { id: string; expiry: string | null; status: string; reasons: string; blocked: boolean }[] = [];
  for (const row of rows) {
    const r = results.get(row.id)!;
    const reasonsJson = JSON.stringify(r.reasons);
    if (
      row.computedExpiry !== r.computedExpiry ||
      row.effectiveStatus !== r.effectiveStatus ||
      row.checkoutBlocked !== r.checkoutBlocked ||
      JSON.stringify(row.statusReasons) !== reasonsJson
    ) {
      changed.push({
        id: row.id,
        expiry: r.computedExpiry,
        status: r.effectiveStatus,
        reasons: reasonsJson,
        blocked: r.checkoutBlocked,
      });
      if (row.effectiveStatus !== r.effectiveStatus) {
        await recordStatusChange(tx, {
          organizationId,
          itemId: row.id,
          previous: row.effectiveStatus,
          next: r.effectiveStatus,
          reason: r.reasons[0]?.label ?? "All checks passed",
          source: opts.source ?? "system",
          userId: opts.actorId ?? null,
        });
      }
    }
  }

  // Batched update in chunks.
  for (let i = 0; i < changed.length; i += 200) {
    const chunk = changed.slice(i, i + 200);
    const values = sql.join(
      chunk.map(
        (c) =>
          sql`(${c.id}::uuid, ${c.expiry}::date, ${c.status}::item_status, ${c.reasons}::jsonb, ${c.blocked}::boolean)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      update inventory_items as i set
        computed_expiry = v.expiry,
        effective_status = v.status,
        status_reasons = v.reasons,
        checkout_blocked = v.blocked
      from (values ${values}) as v(id, expiry, status, reasons, blocked)
      where i.id = v.id and i.organization_id = ${organizationId}
    `);
  }

  await tx
    .update(organizations)
    .set({ statusRecomputedOn: today })
    .where(eq(organizations.id, organizationId));

  return { today, updated: changed.length };
}

/** Time-based rules (expiry, inspection due) change daily; refresh once per day per tenant. */
export async function ensureFreshStatuses(tx: Tx, organizationId: string) {
  const [org] = await tx
    .select({ recomputed: organizations.statusRecomputedOn, timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) return;
  const today = isoDateInZone(new Date(), org.timezone);
  if (org.recomputed !== today) {
    await recomputeOrgStatuses(tx, organizationId, { source: "daily" });
  }
}
