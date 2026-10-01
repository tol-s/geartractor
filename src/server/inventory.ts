import { and, asc, desc, eq, inArray, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import { Q } from "@/db/columns";
import { alias } from "drizzle-orm/pg-core";
import { sequential, type Tx } from "@/db/tenant";
import {
  assignments,
  configurations,
  consumableAllocations,
  consumableStock,
  inventoryItemTags,
  inventoryItems,
  inventoryTags,
  kitContents,
  kits,
  locations,
  qrCodes,
  reservationItems,
} from "@/db/schema";
import { ALLOWED_CHILDREN, KIND_LABEL, KIND_PREFIX, STATUS_LABEL, type InventoryKind, type ItemStatus } from "@/lib/domain";
import { addMonthsIso, formatQty } from "@/lib/utils";
import { inventoryInputSchema, type InventoryInput } from "@/lib/validators";
import { wouldCreateCycle } from "@/lib/status-rules";
import type { OrgContext } from "./auth/context";
import { AppError, NotFoundError } from "./errors";
import { audit, recordStatusChange } from "./audit";
import { nextCode } from "./codes";
import { recomputeOrgStatuses } from "./status-engine";
import { ensureQrCode } from "./qr";
import { adjustStock, lockStock } from "./consumables";

type Actor = Pick<OrgContext, "orgId" | "user">;

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export type InventoryFilters = {
  q?: string;
  kind?: InventoryKind | "all";
  status?: ItemStatus | "all";
  locationId?: string;
  availability?: "checked_out" | "reserved" | "assigned" | "unassigned" | "insufficient_stock" | "all";
  tag?: string;
  sort?: "code" | "name" | "status" | "expiry" | "updated" | "location" | "qty";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  archived?: boolean;
};

const parentItem = alias(inventoryItems, "parent_item");

export function availabilitySql() {
  return {
    checkedOutCode: sql<string | null>`(
      select c.code from checkout_items ci join checkouts c on c.id = ci.checkout_id
      where ci.inventory_item_id = ${Q.itemId} and ci.status = 'issued' and ci.is_tracked
      limit 1)`,
    reservedUntil: sql<string | null>`(
      select min(ri.starts_at)::text from reservation_items ri
      where ri.inventory_item_id = ${Q.itemId} and ri.active and ri.ends_at > now())`,
    stockUnallocated: sql<number | null>`(
      select (cs.total_quantity - cs.allocated_quantity - cs.issued_quantity)::float8 from consumable_stock cs
      where cs.inventory_item_id = ${Q.itemId})`,
    stockTotal: sql<number | null>`(
      select cs.total_quantity::float8 from consumable_stock cs where cs.inventory_item_id = ${Q.itemId})`,
  };
}

function buildWhere(orgId: string, f: InventoryFilters): SQL[] {
  const where: SQL[] = [eq(inventoryItems.organizationId, orgId)];
  where.push(f.archived ? isNotNull(inventoryItems.archivedAt) : isNull(inventoryItems.archivedAt));
  if (f.kind && f.kind !== "all") where.push(eq(inventoryItems.kind, f.kind));
  if (f.status && f.status !== "all") where.push(eq(inventoryItems.effectiveStatus, f.status));
  if (f.locationId) where.push(eq(inventoryItems.locationId, f.locationId));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(
      ${inventoryItems.code} ilike ${like} or ${inventoryItems.name} ilike ${like}
      or ${inventoryItems.serialNumber} ilike ${like} or ${inventoryItems.techSpec} ilike ${like}
      or ${inventoryItems.manufacturer} ilike ${like}
      or exists (select 1 from inventory_item_tags it join inventory_tags t on t.id = it.tag_id
                 where it.item_id = ${Q.itemId} and t.name ilike ${like})
    )`);
  }
  if (f.tag) {
    where.push(sql`exists (select 1 from inventory_item_tags it join inventory_tags t on t.id = it.tag_id
      where it.item_id = ${Q.itemId} and lower(t.name) = lower(${f.tag}))`);
  }
  switch (f.availability) {
    case "checked_out":
      where.push(sql`exists (select 1 from checkout_items ci where ci.inventory_item_id = ${Q.itemId} and ci.status = 'issued')`);
      break;
    case "reserved":
      where.push(
        sql`exists (select 1 from reservation_items ri where ri.inventory_item_id = ${Q.itemId} and ri.active and ri.ends_at > now())`,
      );
      break;
    case "assigned":
      where.push(sql`exists (select 1 from assignments a where a.child_item_id = ${Q.itemId} and a.unassigned_at is null)`);
      break;
    case "unassigned":
      where.push(sql`not exists (select 1 from assignments a where a.child_item_id = ${Q.itemId} and a.unassigned_at is null)`);
      break;
    case "insufficient_stock":
      where.push(sql`${inventoryItems.kind} = 'consumable' and exists (select 1 from consumable_stock cs where cs.inventory_item_id = ${Q.itemId}
        and (cs.total_quantity - cs.allocated_quantity - cs.issued_quantity) <= coalesce(${inventoryItems.reorderThreshold}, 0))`);
      break;
  }
  return where;
}

export async function listInventory(tx: Tx, orgId: string, f: InventoryFilters) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const where = buildWhere(orgId, f);
  const av = availabilitySql();
  const dir = f.dir === "desc" ? desc : asc;
  const statusOrder = sql`case ${inventoryItems.effectiveStatus} when 'rejected' then 3 when 'missing' then 2 when 'needs_inspection' then 1 else 0 end`;
  const orderBy =
    f.sort === "name"
      ? [dir(sql`lower(${inventoryItems.name})`), asc(inventoryItems.code)]
      : f.sort === "status"
        ? [dir(statusOrder), asc(inventoryItems.code)]
        : f.sort === "expiry"
          ? [
              f.dir === "desc"
                ? sql`${inventoryItems.computedExpiry} desc nulls last`
                : sql`${inventoryItems.computedExpiry} asc nulls last`,
              asc(inventoryItems.code),
            ]
          : f.sort === "updated"
            ? [dir(inventoryItems.updatedAt)]
            : f.sort === "location"
              ? [dir(sql`lower(${locations.name})`), asc(inventoryItems.code)]
              : [dir(inventoryItems.code)];

  const [{ total }] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(and(...where));

  const rows = await tx
    .select({
      id: inventoryItems.id,
      code: inventoryItems.code,
      kind: inventoryItems.kind,
      name: inventoryItems.name,
      techSpec: inventoryItems.techSpec,
      manufacturer: inventoryItems.manufacturer,
      serialNumber: inventoryItems.serialNumber,
      status: inventoryItems.effectiveStatus,
      baseStatus: inventoryItems.status,
      reasons: inventoryItems.statusReasons,
      checkoutBlocked: inventoryItems.checkoutBlocked,
      lifespanMode: inventoryItems.lifespanMode,
      computedExpiry: inventoryItems.computedExpiry,
      quantityUnit: inventoryItems.quantityUnit,
      reorderThreshold: inventoryItems.reorderThreshold,
      locationId: inventoryItems.locationId,
      locationName: locations.name,
      parentId: parentItem.id,
      parentCode: parentItem.code,
      parentName: parentItem.name,
      parentKind: parentItem.kind,
      updatedAt: inventoryItems.updatedAt,
      ...av,
      tags: sql<string[]>`coalesce((select array_agg(t.name order by t.name) from inventory_item_tags it
        join inventory_tags t on t.id = it.tag_id where it.item_id = ${Q.itemId}), '{}')`,
    })
    .from(inventoryItems)
    .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
    .leftJoin(assignments, and(eq(assignments.childItemId, inventoryItems.id), isNull(assignments.unassignedAt)))
    .leftJoin(parentItem, eq(parentItem.id, assignments.parentItemId))
    .where(and(...where))
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export type InventoryRow = Awaited<ReturnType<typeof listInventory>>["rows"][number];

/** Streams all matching rows (used by CSV export) in pages to avoid loading everything at once. */
export async function* iterateInventory(tx: Tx, orgId: string, f: InventoryFilters) {
  let page = 1;
  for (;;) {
    const res = await listInventory(tx, orgId, { ...f, page, pageSize: 100 });
    yield* res.rows;
    if (page >= res.pageCount) break;
    page += 1;
  }
}

/* ------------------------------------------------------------------ */
/* Hierarchy helpers                                                   */
/* ------------------------------------------------------------------ */

export type PathNode = { id: string; code: string; name: string; kind: InventoryKind };

/** Returns ancestors from immediate parent upwards. */
export async function getAncestors(tx: Tx, orgId: string, itemId: string): Promise<PathNode[]> {
  const res = await tx.execute<PathNode & { depth: number }>(sql`
    with recursive up as (
      select a.parent_item_id as id, 1 as depth from assignments a
      where a.child_item_id = ${itemId} and a.unassigned_at is null and a.organization_id = ${orgId}
      union all
      select a.parent_item_id, up.depth + 1 from assignments a join up on a.child_item_id = up.id
      where a.unassigned_at is null and up.depth < 20
    )
    select i.id, i.code, i.name, i.kind, up.depth from up join inventory_items i on i.id = up.id
    order by up.depth asc
  `);
  return res.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind }));
}

export type DescendantNode = PathNode & {
  parentId: string;
  depth: number;
  status: ItemStatus;
  locationId: string | null;
};

/** All tracked descendants (components, configurations, kits) of an assembly. */
export async function getDescendants(tx: Tx, orgId: string, itemId: string): Promise<DescendantNode[]> {
  const res = await tx.execute<{
    id: string;
    code: string;
    name: string;
    kind: InventoryKind;
    parent_id: string;
    depth: number;
    status: ItemStatus;
    location_id: string | null;
  }>(sql`
    with recursive down as (
      select a.child_item_id as id, a.parent_item_id as parent_id, 1 as depth from assignments a
      where a.parent_item_id = ${itemId} and a.unassigned_at is null and a.organization_id = ${orgId}
      union all
      select a.child_item_id, a.parent_item_id, down.depth + 1 from assignments a
      join down on a.parent_item_id = down.id
      where a.unassigned_at is null and down.depth < 20
    )
    select i.id, i.code, i.name, i.kind, down.parent_id, down.depth, i.effective_status as status, i.location_id
    from down join inventory_items i on i.id = down.id
    order by down.depth, i.code
  `);
  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    parentId: r.parent_id,
    depth: Number(r.depth),
    status: r.status,
    locationId: r.location_id,
  }));
}

export async function getAllocationsFor(tx: Tx, orgId: string, parentIds: string[]) {
  if (!parentIds.length) return [];
  return tx
    .select({
      id: consumableAllocations.id,
      parentId: consumableAllocations.parentItemId,
      consumableId: consumableAllocations.consumableItemId,
      required: consumableAllocations.requiredQuantity,
      allocated: consumableAllocations.allocatedQuantity,
      code: inventoryItems.code,
      name: inventoryItems.name,
      unit: inventoryItems.quantityUnit,
      status: inventoryItems.effectiveStatus,
    })
    .from(consumableAllocations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, consumableAllocations.consumableItemId))
    .where(
      and(
        eq(consumableAllocations.organizationId, orgId),
        inArray(consumableAllocations.parentItemId, parentIds),
        isNull(consumableAllocations.releasedAt),
      ),
    )
    .orderBy(asc(inventoryItems.code));
}

async function parentMap(tx: Tx, orgId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ parentId: assignments.parentItemId, childId: assignments.childItemId })
    .from(assignments)
    .where(and(eq(assignments.organizationId, orgId), isNull(assignments.unassignedAt)));
  return new Map(rows.map((r) => [r.childId, r.parentId]));
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export async function getItemOrThrow(tx: Tx, orgId: string, id: string, opts: { lock?: boolean } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("inventory item");
  const q = tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)));
  const rows = opts.lock ? await q.for("update") : await q;
  if (!rows[0]) throw new NotFoundError("inventory item");
  return rows[0];
}

export async function getInventoryDetail(tx: Tx, orgId: string, id: string) {
  const item = await getItemOrThrow(tx, orgId, id);
  const av = availabilitySql();
  const [extra] = await tx
    .select({
      locationName: locations.name,
      ...av,
    })
    .from(inventoryItems)
    .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
    .where(eq(inventoryItems.id, id));

  const [ancestors, descendants, tagRows, qr, stock] = await sequential([
    () => getAncestors(tx, orgId, id),
    () => (item.kind === "configuration" || item.kind === "kit" ? getDescendants(tx, orgId, id) : Promise.resolve([])),
    () =>
      tx
        .select({ id: inventoryTags.id, name: inventoryTags.name, color: inventoryTags.color })
        .from(inventoryItemTags)
        .innerJoin(inventoryTags, eq(inventoryTags.id, inventoryItemTags.tagId))
        .where(eq(inventoryItemTags.itemId, id))
        .orderBy(asc(inventoryTags.name)),
    () => tx.select().from(qrCodes).where(eq(qrCodes.inventoryItemId, id)),
    () =>
      item.kind === "consumable" ? tx.select().from(consumableStock).where(eq(consumableStock.inventoryItemId, id)) : Promise.resolve([]),
  ] as const);

  const assemblyIds = [id, ...descendants.filter((d) => d.kind !== "component").map((d) => d.id)];
  const allocations = item.kind === "configuration" || item.kind === "kit" ? await getAllocationsFor(tx, orgId, assemblyIds) : [];

  const directChildren = descendants.filter((d) => d.parentId === id);
  const contents =
    item.kind === "kit"
      ? await tx
          .select()
          .from(kitContents)
          .where(eq(kitContents.kitItemId, id))
          .orderBy(asc(kitContents.sortOrder), asc(kitContents.createdAt))
      : [];

  // Where this consumable is allocated.
  const allocatedTo =
    item.kind === "consumable"
      ? await tx
          .select({
            id: consumableAllocations.id,
            parentId: inventoryItems.id,
            parentCode: inventoryItems.code,
            parentName: inventoryItems.name,
            parentKind: inventoryItems.kind,
            required: consumableAllocations.requiredQuantity,
            allocated: consumableAllocations.allocatedQuantity,
          })
          .from(consumableAllocations)
          .innerJoin(inventoryItems, eq(inventoryItems.id, consumableAllocations.parentItemId))
          .where(and(eq(consumableAllocations.consumableItemId, id), isNull(consumableAllocations.releasedAt)))
      : [];

  let purpose: string | null = null;
  if (item.kind === "configuration") {
    const [c] = await tx.select().from(configurations).where(eq(configurations.inventoryItemId, id));
    purpose = c?.purpose ?? null;
  } else if (item.kind === "kit") {
    const [k] = await tx.select().from(kits).where(eq(kits.inventoryItemId, id));
    purpose = k?.purpose ?? null;
  }

  return {
    item,
    locationName: extra?.locationName ?? null,
    checkedOutCode: extra?.checkedOutCode ?? null,
    reservedUntil: extra?.reservedUntil ?? null,
    stockUnallocated: extra?.stockUnallocated ?? null,
    ancestors,
    descendants,
    directChildren,
    allocations,
    allocatedTo,
    contents,
    tags: tagRows,
    qr: qr[0] ?? null,
    stock: stock[0] ?? null,
    purpose,
  };
}

export type InventoryDetail = Awaited<ReturnType<typeof getInventoryDetail>>;

/* ------------------------------------------------------------------ */
/* Create / update                                                     */
/* ------------------------------------------------------------------ */

async function assertLocation(tx: Tx, orgId: string, locationId: string) {
  const [loc] = await tx
    .select({ id: locations.id, isActive: locations.isActive })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.organizationId, orgId)));
  if (!loc) throw new AppError("Invalid location", "Select a valid storage location.", "validation");
  if (!loc.isActive) throw new AppError("Location inactive", "This storage location is inactive.", "validation");
}

async function setTags(tx: Tx, orgId: string, itemId: string, names: string[]) {
  const unique = Array.from(new Map(names.map((n) => [n.toLowerCase(), n.trim()])).values()).filter(Boolean);
  await tx.delete(inventoryItemTags).where(eq(inventoryItemTags.itemId, itemId));
  if (!unique.length) return;
  for (const name of unique) {
    await tx.insert(inventoryTags).values({ organizationId: orgId, name }).onConflictDoNothing();
  }
  const tagRows = await tx
    .select({ id: inventoryTags.id })
    .from(inventoryTags)
    .where(
      and(
        eq(inventoryTags.organizationId, orgId),
        inArray(
          sql`lower(${inventoryTags.name})`,
          unique.map((u) => u.toLowerCase()),
        ),
      ),
    );
  await tx
    .insert(inventoryItemTags)
    .values(tagRows.map((t) => ({ organizationId: orgId, itemId, tagId: t.id })))
    .onConflictDoNothing();
}

function deriveInspectionDates(v: {
  annualInspectionRequired: boolean;
  lastInspectionDate: string | null;
  nextInspectionDate: string | null;
  inspectionIntervalMonths: number;
}) {
  if (v.annualInspectionRequired && v.lastInspectionDate && !v.nextInspectionDate) {
    return addMonthsIso(v.lastInspectionDate, v.inspectionIntervalMonths);
  }
  return v.nextInspectionDate;
}

export async function createInventoryItem(tx: Tx, actor: Actor, raw: InventoryInput) {
  const v = inventoryInputSchema.parse(raw);
  await assertLocation(tx, actor.orgId, v.locationId);
  const code = await nextCode(tx, actor.orgId, KIND_PREFIX[v.kind]);
  const [item] = await tx
    .insert(inventoryItems)
    .values({
      organizationId: actor.orgId,
      code,
      kind: v.kind,
      name: v.name,
      serialNumber: v.serialNumber,
      techSpec: v.techSpec,
      manufacturer: v.manufacturer,
      locationId: v.locationId,
      status: v.status,
      manufactureDate: v.manufactureDate,
      firstUseDate: v.firstUseDate,
      lifespanMode: v.lifespanMode,
      lifespanMonths: v.lifespanMode === "finite" ? v.lifespanMonths : null,
      expiryBasis: v.lifespanMode === "finite" ? v.expiryBasis : null,
      explicitExpiry: v.lifespanMode === "unlimited" ? null : v.explicitExpiry,
      annualInspectionRequired: v.annualInspectionRequired,
      inspectionIntervalMonths: v.inspectionIntervalMonths,
      lastInspectionDate: v.lastInspectionDate,
      nextInspectionDate: deriveInspectionDates(v),
      lastUseDate: v.lastUseDate,
      technicalDetails: v.technicalDetails,
      notes: v.notes,
      quantityUnit: v.kind === "consumable" ? v.quantityUnit : null,
      reorderThreshold: v.kind === "consumable" ? v.reorderThreshold : null,
      createdBy: actor.user.id,
    })
    .returning();

  if (v.kind === "configuration") {
    await tx.insert(configurations).values({ inventoryItemId: item.id, organizationId: actor.orgId, purpose: v.purpose });
  } else if (v.kind === "kit") {
    await tx.insert(kits).values({ inventoryItemId: item.id, organizationId: actor.orgId, purpose: v.purpose });
  } else if (v.kind === "consumable") {
    await tx.insert(consumableStock).values({ inventoryItemId: item.id, organizationId: actor.orgId });
    if (v.initialQuantity && v.initialQuantity > 0) {
      await adjustStock(tx, actor, item.id, {
        type: "receive",
        delta: v.initialQuantity,
        note: "Initial stock",
      });
    }
  }

  await setTags(tx, actor.orgId, item.id, v.tags);
  await ensureQrCode(tx, actor.orgId, item.id);
  await recordStatusChange(tx, {
    organizationId: actor.orgId,
    itemId: item.id,
    previous: null,
    next: v.status,
    reason: v.statusReason ?? "Created",
    source: "user",
    userId: actor.user.id,
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "create",
    entityType: v.kind,
    entityId: item.id,
    entityLabel: `${code} ${v.name}`,
    next: { ...v, code },
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id, source: "user" });
  return item;
}

const AUDITED_FIELDS = [
  "name",
  "serialNumber",
  "techSpec",
  "manufacturer",
  "locationId",
  "status",
  "manufactureDate",
  "firstUseDate",
  "lifespanMode",
  "lifespanMonths",
  "expiryBasis",
  "explicitExpiry",
  "annualInspectionRequired",
  "inspectionIntervalMonths",
  "lastInspectionDate",
  "nextInspectionDate",
  "lastUseDate",
  "technicalDetails",
  "notes",
  "reorderThreshold",
] as const;

export async function updateInventoryItem(tx: Tx, actor: Actor, id: string, raw: InventoryInput) {
  const existing = await getItemOrThrow(tx, actor.orgId, id, { lock: true });
  const v = inventoryInputSchema.parse({ ...raw, kind: existing.kind });
  if (existing.archivedAt) throw new AppError("Archived", "Restore this item before editing it.", "archived");

  const locationChanged = v.locationId !== existing.locationId;
  if (locationChanged) {
    await assertLocation(tx, actor.orgId, v.locationId);
    const ancestors = await getAncestors(tx, actor.orgId, id);
    if (ancestors.length) {
      throw new AppError(
        "Location is managed by the parent",
        `${existing.code} is assigned to ${KIND_LABEL[ancestors[0].kind]} ${ancestors[0].code}. Change the location of the parent instead.`,
        "assigned",
        { itemId: ancestors[0].id, itemCode: ancestors[0].code },
      );
    }
    const [out] = await tx
      .execute<{ n: number }>(
        sql`
      select count(*)::int as n from checkout_items where inventory_item_id = ${id} and status = 'issued'
    `,
      )
      .then((r) => r.rows);
    if (out && Number(out.n) > 0 && existing.kind !== "consumable") {
      throw new AppError("Checked out", `${existing.code} is currently checked out. Check it in before moving it.`, "checked_out");
    }
  }

  const next = {
    name: v.name,
    serialNumber: v.serialNumber,
    techSpec: v.techSpec,
    manufacturer: v.manufacturer,
    locationId: v.locationId,
    status: v.status,
    manufactureDate: v.manufactureDate,
    firstUseDate: v.firstUseDate,
    lifespanMode: v.lifespanMode,
    lifespanMonths: v.lifespanMode === "finite" ? v.lifespanMonths : null,
    expiryBasis: v.lifespanMode === "finite" ? v.expiryBasis : null,
    explicitExpiry: v.lifespanMode === "unlimited" ? null : v.explicitExpiry,
    annualInspectionRequired: v.annualInspectionRequired,
    inspectionIntervalMonths: v.inspectionIntervalMonths,
    lastInspectionDate: v.lastInspectionDate,
    nextInspectionDate: deriveInspectionDates(v),
    lastUseDate: v.lastUseDate,
    technicalDetails: v.technicalDetails,
    notes: v.notes,
    reorderThreshold: existing.kind === "consumable" ? v.reorderThreshold : null,
  };

  const previous: Record<string, unknown> = {};
  const changed: Record<string, unknown> = {};
  for (const key of AUDITED_FIELDS) {
    const before = (existing as Record<string, unknown>)[key] ?? null;
    const after = (next as Record<string, unknown>)[key] ?? null;
    if (String(before) !== String(after)) {
      previous[key] = before;
      changed[key] = after;
    }
  }

  if (v.status !== existing.status && !v.statusReason) {
    throw new AppError("Reason required", "Enter a reason for the status change.", "validation", {
      details: ["statusReason"],
    });
  }

  await tx
    .update(inventoryItems)
    .set({ ...next, updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, actor.orgId)));

  if (existing.kind === "configuration") {
    await tx.update(configurations).set({ purpose: v.purpose }).where(eq(configurations.inventoryItemId, id));
  } else if (existing.kind === "kit") {
    await tx.update(kits).set({ purpose: v.purpose }).where(eq(kits.inventoryItemId, id));
  }
  await setTags(tx, actor.orgId, id, v.tags);

  if (locationChanged) {
    // Assemblies move with their tracked contents.
    const descendants = await getDescendants(tx, actor.orgId, id);
    if (descendants.length) {
      await tx
        .update(inventoryItems)
        .set({ locationId: v.locationId, updatedAt: new Date() })
        .where(
          and(
            eq(inventoryItems.organizationId, actor.orgId),
            inArray(
              inventoryItems.id,
              descendants.map((d) => d.id),
            ),
          ),
        );
    }
    await audit(tx, {
      organizationId: actor.orgId,
      actorId: actor.user.id,
      action: "location_change",
      entityType: existing.kind,
      entityId: id,
      entityLabel: `${existing.code} ${existing.name}`,
      previous: { locationId: existing.locationId },
      next: { locationId: v.locationId, movedDescendants: descendants.map((d) => d.code) },
    });
  }

  if (v.status !== existing.status) {
    await recordStatusChange(tx, {
      organizationId: actor.orgId,
      itemId: id,
      previous: existing.status,
      next: v.status,
      reason: v.statusReason,
      source: "user",
      userId: actor.user.id,
    });
    await audit(tx, {
      organizationId: actor.orgId,
      actorId: actor.user.id,
      action: "status_change",
      entityType: existing.kind,
      entityId: id,
      entityLabel: `${existing.code} ${existing.name}`,
      previous: { status: STATUS_LABEL[existing.status] },
      next: { status: STATUS_LABEL[v.status] },
      reason: v.statusReason,
    });
  }

  if (Object.keys(changed).length) {
    await audit(tx, {
      organizationId: actor.orgId,
      actorId: actor.user.id,
      action: "edit",
      entityType: existing.kind,
      entityId: id,
      entityLabel: `${existing.code} ${v.name}`,
      previous,
      next: changed,
    });
  }
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id, source: "user" });
}

/** Manual status change (e.g. report issue, mark missing) with a mandatory reason. */
export async function setItemStatus(tx: Tx, actor: Actor, id: string, status: ItemStatus, reason: string, source = "user") {
  const existing = await getItemOrThrow(tx, actor.orgId, id, { lock: true });
  if (!reason.trim()) throw new AppError("Reason required", "Enter a reason for the status change.", "validation");
  if (existing.status === status) return;
  await tx
    .update(inventoryItems)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, actor.orgId)));
  await recordStatusChange(tx, {
    organizationId: actor.orgId,
    itemId: id,
    previous: existing.status,
    next: status,
    reason,
    source,
    userId: actor.user.id,
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "status_change",
    entityType: existing.kind,
    entityId: id,
    entityLabel: `${existing.code} ${existing.name}`,
    previous: { status: STATUS_LABEL[existing.status] },
    next: { status: STATUS_LABEL[status] },
    reason,
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id, source });
}

export async function archiveInventoryItem(tx: Tx, actor: Actor, id: string, reason: string) {
  const item = await getItemOrThrow(tx, actor.orgId, id, { lock: true });
  if (item.archivedAt) return;
  const issued = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from checkout_items where inventory_item_id = ${id} and status in ('issued','pending')`,
  );
  if (Number(issued.rows[0]?.n ?? 0) > 0) {
    throw new AppError("Item in use", `${item.code} is part of an active or in-progress checkout.`, "in_use");
  }
  const ancestors = await getAncestors(tx, actor.orgId, id);
  if (ancestors.length) {
    throw new AppError("Item is assigned", `Remove ${item.code} from ${ancestors[0].code} before archiving it.`, "assigned", {
      itemId: ancestors[0].id,
    });
  }
  const children = await tx
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.parentItemId, id), isNull(assignments.unassignedAt)));
  const allocs = await tx
    .select({ id: consumableAllocations.id })
    .from(consumableAllocations)
    .where(
      and(
        isNull(consumableAllocations.releasedAt),
        sql`(${consumableAllocations.parentItemId} = ${id} or ${consumableAllocations.consumableItemId} = ${id})`,
      ),
    );
  if (children.length || allocs.length) {
    throw new AppError("Assembly has contents", "Remove all applied gear and consumable allocations before archiving.", "has_children");
  }
  await tx
    .update(reservationItems)
    .set({ active: false })
    .where(and(eq(reservationItems.inventoryItemId, id), sql`${reservationItems.endsAt} > now()`));
  await tx
    .update(inventoryItems)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, actor.orgId)));
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "archive",
    entityType: item.kind,
    entityId: id,
    entityLabel: `${item.code} ${item.name}`,
    reason,
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id });
}

export async function restoreInventoryItem(tx: Tx, actor: Actor, id: string) {
  const item = await getItemOrThrow(tx, actor.orgId, id, { lock: true });
  if (!item.archivedAt) return;
  await tx
    .update(inventoryItems)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, actor.orgId)));
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "restore",
    entityType: item.kind,
    entityId: id,
    entityLabel: `${item.code} ${item.name}`,
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id });
}

/* ------------------------------------------------------------------ */
/* Assignment (Applied Gear)                                           */
/* ------------------------------------------------------------------ */

type Eligibility = { eligible: boolean; reasons: string[] };

async function isCheckedOutOrPending(tx: Tx, itemId: string) {
  const r = await tx.execute<{ status: string; code: string }>(sql`
    select ci.status, c.code from checkout_items ci join checkouts c on c.id = ci.checkout_id
    where ci.inventory_item_id = ${itemId} and ci.status = 'issued' limit 1
  `);
  return r.rows[0] ?? null;
}

async function hasActiveReservation(tx: Tx, itemId: string) {
  const r = await tx.execute<{ code: string }>(sql`
    select r.code from reservation_items ri join reservations r on r.id = ri.reservation_id
    where ri.inventory_item_id = ${itemId} and ri.active and ri.ends_at > now() limit 1
  `);
  return r.rows[0]?.code ?? null;
}

/** Evaluates whether `child` may be applied to `parent` (Configuration or Kit). */
export async function evaluateAssignment(
  tx: Tx,
  orgId: string,
  parent: typeof inventoryItems.$inferSelect,
  child: typeof inventoryItems.$inferSelect,
  parents?: Map<string, string>,
): Promise<Eligibility> {
  const reasons: string[] = [];
  if (parent.kind !== "configuration" && parent.kind !== "kit") {
    reasons.push("Only Configurations and Kits can contain gear");
  } else if (!ALLOWED_CHILDREN[parent.kind].includes(child.kind)) {
    reasons.push(`${KIND_LABEL[parent.kind]}s cannot contain ${KIND_LABEL[child.kind]}s`);
  }
  if (child.id === parent.id) reasons.push("An item cannot contain itself");
  if (child.archivedAt) reasons.push("Archived");
  if (child.kind === "consumable") {
    reasons.push("Consumables are allocated by quantity");
    return { eligible: false, reasons };
  }
  const pm = parents ?? (await parentMap(tx, orgId));
  if (pm.has(child.id)) {
    reasons.push(pm.get(child.id) === parent.id ? "Already applied here" : "Already assigned to another assembly");
  }
  if (wouldCreateCycle(parent.id, child.id, pm)) reasons.push("Would create a circular relationship");
  if (child.effectiveStatus !== "available") reasons.push(`Status is ${STATUS_LABEL[child.effectiveStatus]}`);
  if (child.locationId !== parent.locationId) reasons.push("Different storage location");
  const out = await isCheckedOutOrPending(tx, child.id);
  if (out) reasons.push(`Checked out on ${out.code}`);
  const parentOut = await isCheckedOutOrPending(tx, parent.id);
  if (parentOut) reasons.push(`${parent.code} is checked out on ${parentOut.code}`);
  const res = await hasActiveReservation(tx, child.id);
  if (res) reasons.push(`Reserved on ${res}`);
  return { eligible: reasons.length === 0, reasons };
}

export async function assignChild(tx: Tx, actor: Actor, parentId: string, childId: string) {
  // Lock both rows (ordered by id to avoid deadlocks).
  const [a, b] = [parentId, childId].sort();
  await getItemOrThrow(tx, actor.orgId, a, { lock: true });
  await getItemOrThrow(tx, actor.orgId, b, { lock: true });
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"assign:" + actor.orgId}, 0))`);
  const parent = await getItemOrThrow(tx, actor.orgId, parentId);
  const child = await getItemOrThrow(tx, actor.orgId, childId);
  const verdict = await evaluateAssignment(tx, actor.orgId, parent, child);
  if (!verdict.eligible) {
    throw new AppError(
      "Unable to add gear",
      `${child.code} cannot be added to ${parent.code}: ${verdict.reasons.join("; ")}.`,
      "not_eligible",
      { itemId: child.id, itemCode: child.code, details: verdict.reasons },
    );
  }
  await tx.insert(assignments).values({
    organizationId: actor.orgId,
    parentItemId: parentId,
    childItemId: childId,
    assignedBy: actor.user.id,
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "assignment",
    entityType: child.kind,
    entityId: child.id,
    entityLabel: `${child.code} ${child.name}`,
    next: { parent: `${parent.code} ${parent.name}` },
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "assignment",
    entityType: parent.kind,
    entityId: parent.id,
    entityLabel: `${parent.code} ${parent.name}`,
    next: { added: `${child.code} ${child.name}` },
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id });
}

export async function unassignChild(tx: Tx, actor: Actor, parentId: string, childId: string, reason?: string) {
  const parent = await getItemOrThrow(tx, actor.orgId, parentId, { lock: true });
  const child = await getItemOrThrow(tx, actor.orgId, childId, { lock: true });
  const out = await isCheckedOutOrPending(tx, parentId);
  if (out) {
    throw new AppError("Checked out", `${parent.code} is checked out on ${out.code}. Check it in first.`, "checked_out");
  }
  const updated = await tx
    .update(assignments)
    .set({ unassignedAt: new Date(), unassignedBy: actor.user.id })
    .where(and(eq(assignments.parentItemId, parentId), eq(assignments.childItemId, childId), isNull(assignments.unassignedAt)))
    .returning({ id: assignments.id });
  if (!updated.length) throw new AppError("Not assigned", `${child.code} is not part of ${parent.code}.`, "not_found");
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "unassignment",
    entityType: child.kind,
    entityId: child.id,
    entityLabel: `${child.code} ${child.name}`,
    previous: { parent: `${parent.code} ${parent.name}` },
    reason: reason ?? null,
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "unassignment",
    entityType: parent.kind,
    entityId: parent.id,
    entityLabel: `${parent.code} ${parent.name}`,
    previous: { removed: `${child.code} ${child.name}` },
    reason: reason ?? null,
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id });
}

/** Candidate list for "Add Gear", including why ineligible items cannot be applied. */
export async function listAssignmentCandidates(tx: Tx, orgId: string, parentId: string, q: string) {
  const parent = await getItemOrThrow(tx, orgId, parentId);
  if (parent.kind !== "configuration" && parent.kind !== "kit") return [];
  const kinds = ALLOWED_CHILDREN[parent.kind];
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const candidates = await tx
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.organizationId, orgId),
        isNull(inventoryItems.archivedAt),
        inArray(inventoryItems.kind, kinds),
        sql`${inventoryItems.id} <> ${parentId}`,
        q ? sql`(${inventoryItems.code} ilike ${like} or ${inventoryItems.name} ilike ${like})` : sql`true`,
      ),
    )
    .orderBy(sql`case when ${inventoryItems.locationId} = ${parent.locationId} then 0 else 1 end`, asc(inventoryItems.code))
    .limit(40);
  const pm = await parentMap(tx, orgId);
  const stockRows = candidates.some((c) => c.kind === "consumable")
    ? await tx
        .select()
        .from(consumableStock)
        .where(
          inArray(
            consumableStock.inventoryItemId,
            candidates.filter((c) => c.kind === "consumable").map((c) => c.id),
          ),
        )
    : [];
  const stockById = new Map(stockRows.map((s) => [s.inventoryItemId, s]));
  const existingAllocs = await tx
    .select({ consumableId: consumableAllocations.consumableItemId })
    .from(consumableAllocations)
    .where(and(eq(consumableAllocations.parentItemId, parentId), isNull(consumableAllocations.releasedAt)));
  const allocated = new Set(existingAllocs.map((a) => a.consumableId));

  const out = [];
  for (const c of candidates) {
    if (c.kind === "consumable") {
      const s = stockById.get(c.id);
      const unallocated = s ? s.totalQuantity - s.allocatedQuantity - s.issuedQuantity : 0;
      const reasons: string[] = [];
      if (allocated.has(c.id)) reasons.push("Already allocated here");
      if (c.effectiveStatus !== "available") reasons.push(`Status is ${STATUS_LABEL[c.effectiveStatus]}`);
      if (c.locationId !== parent.locationId) reasons.push("Different storage location");
      if (unallocated <= 0) reasons.push("No unallocated stock");
      out.push({
        id: c.id,
        code: c.code,
        name: c.name,
        kind: c.kind,
        status: c.effectiveStatus,
        eligible: reasons.length === 0,
        reasons,
        unallocated,
        unit: c.quantityUnit,
        available: s ? formatQty(unallocated, c.quantityUnit) : null,
      });
    } else {
      const verdict = await evaluateAssignment(tx, orgId, parent, c, pm);
      out.push({
        id: c.id,
        code: c.code,
        name: c.name,
        kind: c.kind,
        status: c.effectiveStatus,
        eligible: verdict.eligible,
        reasons: verdict.reasons,
        unallocated: null,
        unit: null,
        available: null,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Consumable allocation                                               */
/* ------------------------------------------------------------------ */

export async function allocateConsumable(tx: Tx, actor: Actor, parentId: string, consumableId: string, quantity: number) {
  if (!(quantity > 0)) throw new AppError("Invalid quantity", "Quantity must be greater than zero.", "validation");
  const parent = await getItemOrThrow(tx, actor.orgId, parentId, { lock: true });
  if (parent.kind !== "configuration" && parent.kind !== "kit") {
    throw new AppError("Not an assembly", "Consumables can only be allocated to Configurations or Kits.", "validation");
  }
  const consumable = await getItemOrThrow(tx, actor.orgId, consumableId);
  if (consumable.kind !== "consumable") throw new AppError("Not a consumable", "Select a consumable.", "validation");
  if (consumable.effectiveStatus !== "available") {
    throw new AppError("Unable to allocate", `${consumable.code} is ${STATUS_LABEL[consumable.effectiveStatus]}.`, "not_eligible");
  }
  if (consumable.locationId !== parent.locationId) {
    throw new AppError("Different location", `${consumable.code} is stored at a different location.`, "location");
  }
  const parentOut = await isCheckedOutOrPending(tx, parentId);
  if (parentOut) throw new AppError("Checked out", `${parent.code} is checked out on ${parentOut.code}.`, "checked_out");

  const stock = await lockStock(tx, actor.orgId, consumableId);
  const existing = await tx
    .select()
    .from(consumableAllocations)
    .where(
      and(
        eq(consumableAllocations.parentItemId, parentId),
        eq(consumableAllocations.consumableItemId, consumableId),
        isNull(consumableAllocations.releasedAt),
      ),
    );
  if (existing.length) {
    throw new AppError(
      "Already allocated",
      `${consumable.code} is already allocated to ${parent.code}. Adjust the existing allocation instead.`,
      "duplicate",
    );
  }
  const unallocated = stock.totalQuantity - stock.allocatedQuantity - stock.issuedQuantity;
  if (quantity > unallocated) {
    throw new AppError(
      "Insufficient stock",
      `Only ${formatQty(unallocated, consumable.quantityUnit)} of ${consumable.code} is unallocated.`,
      "insufficient_stock",
      { itemId: consumable.id, itemCode: consumable.code },
    );
  }
  await tx.insert(consumableAllocations).values({
    organizationId: actor.orgId,
    consumableItemId: consumableId,
    parentItemId: parentId,
    requiredQuantity: quantity,
    allocatedQuantity: quantity,
    createdBy: actor.user.id,
  });
  await adjustStock(tx, actor, consumableId, {
    type: "allocate",
    delta: quantity,
    note: `Allocated to ${parent.code}`,
    referenceType: "inventory_item",
    referenceId: parentId,
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "consumable_allocation",
    entityType: parent.kind,
    entityId: parent.id,
    entityLabel: `${parent.code} ${parent.name}`,
    next: { consumable: consumable.code, quantity: formatQty(quantity, consumable.quantityUnit) },
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id });
}

export async function releaseAllocation(tx: Tx, actor: Actor, allocationId: string) {
  const [alloc] = await tx
    .select()
    .from(consumableAllocations)
    .where(and(eq(consumableAllocations.id, allocationId), eq(consumableAllocations.organizationId, actor.orgId)))
    .for("update");
  if (!alloc || alloc.releasedAt) throw new NotFoundError("allocation");
  const parent = await getItemOrThrow(tx, actor.orgId, alloc.parentItemId);
  const parentOut = await isCheckedOutOrPending(tx, alloc.parentItemId);
  if (parentOut) throw new AppError("Checked out", `${parent.code} is checked out on ${parentOut.code}.`, "checked_out");
  await lockStock(tx, actor.orgId, alloc.consumableItemId);
  await tx.update(consumableAllocations).set({ releasedAt: new Date() }).where(eq(consumableAllocations.id, allocationId));
  if (alloc.allocatedQuantity > 0) {
    await adjustStock(tx, actor, alloc.consumableItemId, {
      type: "release",
      delta: alloc.allocatedQuantity,
      note: `Released from ${parent.code}`,
      referenceType: "inventory_item",
      referenceId: parent.id,
    });
  }
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "consumable_allocation",
    entityType: parent.kind,
    entityId: parent.id,
    entityLabel: `${parent.code} ${parent.name}`,
    previous: { allocationReleased: alloc.allocatedQuantity },
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id });
}

/** Tops an allocation back up to its required quantity from unallocated stock. */
export async function replenishAllocation(tx: Tx, actor: Actor, allocationId: string) {
  const [alloc] = await tx
    .select()
    .from(consumableAllocations)
    .where(and(eq(consumableAllocations.id, allocationId), eq(consumableAllocations.organizationId, actor.orgId)))
    .for("update");
  if (!alloc || alloc.releasedAt) throw new NotFoundError("allocation");
  const shortfall = Math.round((alloc.requiredQuantity - alloc.allocatedQuantity) * 1000) / 1000;
  if (shortfall <= 0) return;
  const consumable = await getItemOrThrow(tx, actor.orgId, alloc.consumableItemId);
  const stock = await lockStock(tx, actor.orgId, alloc.consumableItemId);
  const unallocated = stock.totalQuantity - stock.allocatedQuantity - stock.issuedQuantity;
  if (unallocated < shortfall) {
    throw new AppError(
      "Insufficient stock",
      `${consumable.code} needs ${formatQty(shortfall, consumable.quantityUnit)} but only ${formatQty(unallocated, consumable.quantityUnit)} is unallocated.`,
      "insufficient_stock",
    );
  }
  await tx
    .update(consumableAllocations)
    .set({ allocatedQuantity: alloc.requiredQuantity })
    .where(eq(consumableAllocations.id, allocationId));
  await adjustStock(tx, actor, alloc.consumableItemId, {
    type: "allocate",
    delta: shortfall,
    note: "Allocation replenished",
    referenceType: "inventory_item",
    referenceId: alloc.parentItemId,
  });
  await recomputeOrgStatuses(tx, actor.orgId, { actorId: actor.user.id });
}

/* ------------------------------------------------------------------ */
/* Kit manual contents                                                 */
/* ------------------------------------------------------------------ */

export async function addKitContent(tx: Tx, actor: Actor, kitId: string, description: string, quantity: string | null) {
  const kit = await getItemOrThrow(tx, actor.orgId, kitId);
  if (kit.kind !== "kit") throw new AppError("Not a kit", "Manual contents can only be added to Kits.", "validation");
  const text = description.trim();
  if (!text) throw new AppError("Description required", "Describe the manual content.", "validation");
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${kitContents.sortOrder}), 0)::int` })
    .from(kitContents)
    .where(eq(kitContents.kitItemId, kitId));
  await tx.insert(kitContents).values({
    organizationId: actor.orgId,
    kitItemId: kitId,
    description: text.slice(0, 300),
    quantity: quantity?.trim().slice(0, 40) || null,
    sortOrder: Number(max) + 1,
  });
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "edit",
    entityType: "kit",
    entityId: kitId,
    entityLabel: `${kit.code} ${kit.name}`,
    next: { manualContentAdded: text },
  });
}

export async function removeKitContent(tx: Tx, actor: Actor, contentId: string) {
  const [row] = await tx
    .delete(kitContents)
    .where(and(eq(kitContents.id, contentId), eq(kitContents.organizationId, actor.orgId)))
    .returning();
  if (!row) throw new NotFoundError("kit content");
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "edit",
    entityType: "kit",
    entityId: row.kitItemId,
    previous: { manualContentRemoved: row.description },
  });
}

export async function listTags(tx: Tx, orgId: string) {
  return tx
    .select({ id: inventoryTags.id, name: inventoryTags.name })
    .from(inventoryTags)
    .where(eq(inventoryTags.organizationId, orgId))
    .orderBy(asc(inventoryTags.name));
}
