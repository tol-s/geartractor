import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { inspectionRecords, inspections, inventoryItems, locations, users } from "@/db/schema";
import { STATUS_LABEL, type InspectionOutcome, type ItemStatus } from "@/lib/domain";
import { addMonthsIso } from "@/lib/utils";
import type { OrgContext } from "./auth/context";
import { AppError, NotFoundError } from "./errors";
import { audit, recordStatusChange } from "./audit";
import { nextCode } from "./codes";
import { getDescendants, getItemOrThrow } from "./inventory";
import { orgToday, recomputeOrgStatuses } from "./status-engine";

type Ctx = Pick<OrgContext, "orgId" | "user" | "can">;

export type InspectionSheetItem = {
  id: string;
  code: string;
  name: string;
  kind: string;
  depth: number;
  parentId: string | null;
  baseStatus: ItemStatus;
  effectiveStatus: ItemStatus;
  reasons: { label: string; code: string }[];
  lastInspectionDate: string | null;
  nextInspectionDate: string | null;
  annualInspectionRequired: boolean;
  computedExpiry: string | null;
  lifespanMode: string;
};

export async function buildInspectionSheet(
  tx: Tx,
  orgId: string,
  input: { rootItemId?: string | null; itemIds?: string[] },
): Promise<{ scope: "individual" | "bulk" | "assembly"; rootItemId: string | null; items: InspectionSheetItem[] }> {
  let ids: { id: string; depth: number; parentId: string | null }[] = [];
  let scope: "individual" | "bulk" | "assembly" = "individual";
  let rootItemId: string | null = null;
  if (input.rootItemId) {
    const root = await getItemOrThrow(tx, orgId, input.rootItemId);
    rootItemId = root.id;
    ids.push({ id: root.id, depth: 0, parentId: null });
    if (root.kind === "configuration" || root.kind === "kit") {
      const desc = await getDescendants(tx, orgId, root.id);
      if (desc.length) scope = "assembly";
      ids.push(...desc.map((d) => ({ id: d.id, depth: d.depth, parentId: d.parentId })));
    }
  } else if (input.itemIds?.length) {
    const unique = Array.from(new Set(input.itemIds)).slice(0, 200);
    ids = unique.map((id) => ({ id, depth: 0, parentId: null }));
    scope = unique.length > 1 ? "bulk" : "individual";
  }
  if (!ids.length) return { scope, rootItemId, items: [] };
  const rows = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, orgId), inArray(inventoryItems.id, ids.map((i) => i.id)), isNull(inventoryItems.archivedAt)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: InspectionSheetItem[] = [];
  for (const entry of ids) {
    const r = byId.get(entry.id);
    if (!r) continue;
    items.push({
      id: r.id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      depth: entry.depth,
      parentId: entry.parentId,
      baseStatus: r.status,
      effectiveStatus: r.effectiveStatus,
      reasons: (r.statusReasons ?? []).map((x) => ({ label: x.label, code: x.code })),
      lastInspectionDate: r.lastInspectionDate,
      nextInspectionDate: r.nextInspectionDate,
      annualInspectionRequired: r.annualInspectionRequired,
      computedExpiry: r.computedExpiry,
      lifespanMode: r.lifespanMode,
    });
  }
  return { scope, rootItemId, items };
}

export type InspectionInput = {
  rootItemId?: string | null;
  inspectedOn: string;
  notes?: string | null;
  records: { itemId: string; outcome: InspectionOutcome; notes?: string | null; nextInspectionDate?: string | null }[];
};

/**
 * Records an inspection. Passing updates the next inspection date and clears a
 * "needs inspection" flag, but never overrides Missing, Rejected or a hard expiry.
 */
export async function recordInspection(tx: Tx, ctx: Ctx, input: InspectionInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.inspectedOn)) {
    throw new AppError("Invalid date", "Enter the inspection date as YYYY-MM-DD.", "validation");
  }
  const today = await orgToday(tx, ctx.orgId);
  if (input.inspectedOn > today) throw new AppError("Invalid date", "Inspection date cannot be in the future.", "validation");
  const records = Array.from(new Map(input.records.map((r) => [r.itemId, r])).values());
  if (!records.length) throw new AppError("Nothing to record", "Add at least one item to inspect.", "validation");
  for (const r of records) {
    if (r.outcome === "exception" && !r.notes?.trim()) {
      throw new AppError("Note required", "Explain why an item was not inspected (exception).", "validation");
    }
    if (r.nextInspectionDate && !/^\d{4}-\d{2}-\d{2}$/.test(r.nextInspectionDate)) {
      throw new AppError("Invalid date", "Next inspection dates must use YYYY-MM-DD.", "validation");
    }
  }

  const ids = records.map((r) => r.itemId).sort();
  await tx.execute(sql`
    select id from inventory_items where organization_id = ${ctx.orgId}
    and id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) order by id for update
  `);
  const items = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, ctx.orgId), inArray(inventoryItems.id, ids)));
  if (items.length !== ids.length) throw new NotFoundError("inventory item");
  const byId = new Map(items.map((i) => [i.id, i]));

  let scope: "individual" | "bulk" | "assembly" = records.length > 1 ? "bulk" : "individual";
  if (input.rootItemId) {
    const root = byId.get(input.rootItemId) ?? (await getItemOrThrow(tx, ctx.orgId, input.rootItemId));
    if ((root.kind === "configuration" || root.kind === "kit") && records.length > 1) scope = "assembly";
  }

  const code = await nextCode(tx, ctx.orgId, "INS");
  const [inspection] = await tx
    .insert(inspections)
    .values({
      organizationId: ctx.orgId,
      code,
      inspectorId: ctx.user.id,
      inspectedOn: input.inspectedOn,
      scope,
      rootItemId: input.rootItemId ?? null,
      notes: input.notes?.trim().slice(0, 2000) || null,
    })
    .returning();

  const summary: Record<string, number> = { pass: 0, fail: 0, missing: 0, exception: 0 };
  for (const r of records) {
    const item = byId.get(r.itemId)!;
    const previous = item.status;
    let resulting: ItemStatus = previous;
    let nextDate: string | null = item.nextInspectionDate;
    const patch: Partial<typeof inventoryItems.$inferInsert> = { updatedAt: new Date() };
    if (r.outcome === "pass") {
      resulting = previous === "missing" || previous === "rejected" ? previous : "available";
      nextDate = r.nextInspectionDate ?? addMonthsIso(input.inspectedOn, item.inspectionIntervalMonths || 12);
      patch.lastInspectionDate = input.inspectedOn;
      patch.nextInspectionDate = nextDate;
    } else if (r.outcome === "fail") {
      resulting = "rejected";
      patch.lastInspectionDate = input.inspectedOn;
    } else if (r.outcome === "missing") {
      resulting = "missing";
    }
    patch.status = resulting;
    await tx.update(inventoryItems).set(patch).where(eq(inventoryItems.id, item.id));
    await tx.insert(inspectionRecords).values({
      organizationId: ctx.orgId,
      inspectionId: inspection.id,
      inventoryItemId: item.id,
      outcome: r.outcome,
      previousStatus: previous,
      resultingStatus: resulting,
      nextInspectionDate: r.outcome === "pass" ? nextDate : null,
      notes: r.notes?.trim().slice(0, 1000) || null,
    });
    await recordStatusChange(tx, {
      organizationId: ctx.orgId,
      itemId: item.id,
      previous,
      next: resulting,
      reason: `Inspection ${code}: ${r.outcome}`,
      source: "inspection",
      userId: ctx.user.id,
    });
    await audit(tx, {
      organizationId: ctx.orgId,
      actorId: ctx.user.id,
      action: "inspection",
      entityType: item.kind,
      entityId: item.id,
      entityLabel: `${item.code} ${item.name}`,
      previous: { status: STATUS_LABEL[previous], nextInspection: item.nextInspectionDate },
      next: { status: STATUS_LABEL[resulting], outcome: r.outcome, nextInspection: r.outcome === "pass" ? nextDate : item.nextInspectionDate, inspection: code },
      reason: r.notes ?? null,
    });
    summary[r.outcome] += 1;
  }
  await recomputeOrgStatuses(tx, ctx.orgId, { actorId: ctx.user.id, source: "inspection" });
  return { id: inspection.id, code, summary };
}

export async function listInspections(tx: Tx, orgId: string, page = 1) {
  const pageSize = 20;
  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(inspections).where(eq(inspections.organizationId, orgId));
  const rows = await tx
    .select({
      id: inspections.id,
      code: inspections.code,
      inspectedOn: inspections.inspectedOn,
      scope: inspections.scope,
      notes: inspections.notes,
      inspectorName: users.name,
      rootCode: inventoryItems.code,
      rootName: inventoryItems.name,
      createdAt: inspections.createdAt,
      counts: sql<{ pass: number; fail: number; missing: number; exception: number }>`(
        select json_build_object(
          'pass', count(*) filter (where outcome = 'pass'),
          'fail', count(*) filter (where outcome = 'fail'),
          'missing', count(*) filter (where outcome = 'missing'),
          'exception', count(*) filter (where outcome = 'exception'))
        from inspection_records ir where ir.inspection_id = ${inspections.id})`,
    })
    .from(inspections)
    .leftJoin(users, eq(users.id, inspections.inspectorId))
    .leftJoin(inventoryItems, eq(inventoryItems.id, inspections.rootItemId))
    .where(eq(inspections.organizationId, orgId))
    .orderBy(desc(inspections.inspectedOn), desc(inspections.createdAt))
    .limit(pageSize)
    .offset((Math.max(page, 1) - 1) * pageSize);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getInspection(tx: Tx, orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("inspection");
  const [row] = await tx
    .select({ inspection: inspections, inspectorName: users.name })
    .from(inspections)
    .leftJoin(users, eq(users.id, inspections.inspectorId))
    .where(and(eq(inspections.id, id), eq(inspections.organizationId, orgId)));
  if (!row) throw new NotFoundError("inspection");
  const records = await tx
    .select({
      id: inspectionRecords.id,
      itemId: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      outcome: inspectionRecords.outcome,
      previousStatus: inspectionRecords.previousStatus,
      resultingStatus: inspectionRecords.resultingStatus,
      nextInspectionDate: inspectionRecords.nextInspectionDate,
      notes: inspectionRecords.notes,
    })
    .from(inspectionRecords)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inspectionRecords.inventoryItemId))
    .where(eq(inspectionRecords.inspectionId, id))
    .orderBy(asc(inventoryItems.code));
  return { ...row, records };
}

export async function itemInspectionHistory(tx: Tx, orgId: string, itemId: string) {
  return tx
    .select({
      id: inspectionRecords.id,
      inspectionId: inspections.id,
      code: inspections.code,
      inspectedOn: inspections.inspectedOn,
      outcome: inspectionRecords.outcome,
      resultingStatus: inspectionRecords.resultingStatus,
      nextInspectionDate: inspectionRecords.nextInspectionDate,
      notes: inspectionRecords.notes,
      inspectorName: users.name,
    })
    .from(inspectionRecords)
    .innerJoin(inspections, eq(inspections.id, inspectionRecords.inspectionId))
    .leftJoin(users, eq(users.id, inspections.inspectorId))
    .where(and(eq(inspectionRecords.organizationId, orgId), eq(inspectionRecords.inventoryItemId, itemId)))
    .orderBy(desc(inspections.inspectedOn), desc(inspectionRecords.createdAt))
    .limit(50);
}

/** Items needing attention, plus items due for inspection within 30 days. */
export async function listAttentionItems(tx: Tx, orgId: string) {
  const today = await orgToday(tx, orgId);
  const soon = addMonthsIso(today, 1);
  return tx
    .select({
      id: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      status: inventoryItems.effectiveStatus,
      reasons: inventoryItems.statusReasons,
      nextInspectionDate: inventoryItems.nextInspectionDate,
      computedExpiry: inventoryItems.computedExpiry,
      locationName: locations.name,
      assigned: sql<boolean>`exists (select 1 from assignments a where a.child_item_id = ${inventoryItems.id} and a.unassigned_at is null)`,
    })
    .from(inventoryItems)
    .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
    .where(
      and(
        eq(inventoryItems.organizationId, orgId),
        isNull(inventoryItems.archivedAt),
        sql`(${inventoryItems.effectiveStatus} = 'needs_inspection'
          or (${inventoryItems.annualInspectionRequired} and ${inventoryItems.nextInspectionDate} <= ${soon}::date)
          or ${inventoryItems.checkoutBlocked})`,
      ),
    )
    .orderBy(
      sql`case ${inventoryItems.effectiveStatus} when 'rejected' then 0 when 'missing' then 1 when 'needs_inspection' then 2 else 3 end`,
      asc(inventoryItems.nextInspectionDate),
      asc(inventoryItems.code),
    )
    .limit(200);
}
