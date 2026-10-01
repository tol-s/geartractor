import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { Q } from "@/db/columns";
import type { Tx } from "@/db/tenant";
import {
  checkouts,
  consumableStock,
  inventoryItems,
  locations,
  reservationItems,
  reservations,
  users,
} from "@/db/schema";
import { STATUS_LABEL, type InventoryKind } from "@/lib/domain";
import { formatQty } from "@/lib/utils";
import type { OrgContext } from "./auth/context";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { audit } from "./audit";
import { nextCode } from "./codes";

type Ctx = Pick<OrgContext, "orgId" | "user" | "can" | "org">;
const round = (n: number) => Math.round(n * 1000) / 1000;

export type ReservationAvailability = "available" | "reserved" | "unavailable";

export type ReservationCandidate = {
  id: string;
  code: string;
  name: string;
  kind: InventoryKind;
  status: string;
  unit: string | null;
  locationName: string | null;
  availability: ReservationAvailability;
  note: string | null;
  freeQuantity: number | null;
};

export async function evaluateReservationAvailability(
  tx: Tx,
  orgId: string,
  itemIds: string[],
  window: { startsAt: Date; endsAt: Date; locationId: string; excludeReservationId?: string | null },
  quantities?: Map<string, number>,
): Promise<Map<string, { availability: ReservationAvailability; note: string | null; freeQuantity: number | null }>> {
  const out = new Map<string, { availability: ReservationAvailability; note: string | null; freeQuantity: number | null }>();
  if (!itemIds.length) return out;
  const ids = sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `);
  const items = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, orgId), inArray(inventoryItems.id, itemIds)));
  const assigned = await tx.execute<{ child_item_id: string }>(
    sql`select child_item_id from assignments where unassigned_at is null and child_item_id in (${ids})`,
  );
  const assignedSet = new Set(assigned.rows.map((r) => r.child_item_id));
  const overlaps = await tx.execute<{ inventory_item_id: string; code: string; event_name: string; quantity: number }>(sql`
    select ri.inventory_item_id, r.code, r.event_name, ri.quantity::float8 as quantity
    from reservation_items ri join reservations r on r.id = ri.reservation_id
    where ri.active and ri.inventory_item_id in (${ids})
      and tstzrange(ri.starts_at, ri.ends_at, '[)') && tstzrange(${window.startsAt.toISOString()}::timestamptz, ${window.endsAt.toISOString()}::timestamptz, '[)')
      ${window.excludeReservationId ? sql`and ri.reservation_id <> ${window.excludeReservationId}` : sql``}
  `);
  const outNow = await tx.execute<{ inventory_item_id: string; code: string; due_at: string | null }>(sql`
    select ci.inventory_item_id, c.code, c.due_at::text from checkout_items ci join checkouts c on c.id = ci.checkout_id
    where ci.status = 'issued' and ci.is_tracked and ci.inventory_item_id in (${ids})
  `);
  const stocks = await tx.select().from(consumableStock).where(inArray(consumableStock.inventoryItemId, itemIds));
  const stockMap = new Map(stocks.map((s) => [s.inventoryItemId, s]));

  for (const item of items) {
    let availability: ReservationAvailability = "available";
    let note: string | null = null;
    let freeQuantity: number | null = null;
    if (item.archivedAt) {
      availability = "unavailable";
      note = "Archived";
    } else if (assignedSet.has(item.id)) {
      availability = "unavailable";
      note = "Assigned to an assembly; reserve the parent instead";
    } else if (item.locationId !== window.locationId) {
      availability = "unavailable";
      note = "Stored at another location";
    } else if (item.effectiveStatus === "rejected" || item.effectiveStatus === "missing") {
      availability = "unavailable";
      note = STATUS_LABEL[item.effectiveStatus];
    } else if (item.kind === "consumable") {
      const s = stockMap.get(item.id);
      const unallocated = s ? s.totalQuantity - s.allocatedQuantity - s.issuedQuantity : 0;
      const reservedQty = overlaps.rows
        .filter((o) => o.inventory_item_id === item.id)
        .reduce((sum, o) => sum + Number(o.quantity), 0);
      freeQuantity = round(unallocated - reservedQty);
      const want = quantities?.get(item.id) ?? 0;
      if (freeQuantity <= 0) {
        availability = reservedQty > 0 ? "reserved" : "unavailable";
        note = reservedQty > 0 ? "Fully reserved for this time" : "Insufficient Stock";
      } else if (want > freeQuantity) {
        availability = "unavailable";
        note = `Only ${formatQty(freeQuantity, item.quantityUnit)} available`;
      }
    } else {
      const conflict = overlaps.rows.find((o) => o.inventory_item_id === item.id);
      const checkedOut = outNow.rows.find((o) => o.inventory_item_id === item.id);
      if (conflict) {
        availability = "reserved";
        note = `Reserved for ${conflict.event_name} (${conflict.code})`;
      } else if (checkedOut && (!checkedOut.due_at || new Date(checkedOut.due_at) > window.startsAt)) {
        availability = "unavailable";
        note = `Checked out on ${checkedOut.code}`;
      } else if (item.effectiveStatus === "needs_inspection" || item.checkoutBlocked) {
        note = "Needs inspection before checkout";
      }
    }
    out.set(item.id, { availability, note, freeQuantity });
  }
  return out;
}

export async function searchReservationCandidates(
  tx: Tx,
  ctx: Ctx,
  f: { q?: string; kind?: InventoryKind | "all"; startsAt: Date; endsAt: Date; locationId: string },
): Promise<ReservationCandidate[]> {
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const where: SQL[] = [eq(inventoryItems.organizationId, ctx.orgId), isNull(inventoryItems.archivedAt)];
  if (f.kind && f.kind !== "all") where.push(eq(inventoryItems.kind, f.kind));
  if (like) where.push(sql`(${inventoryItems.code} ilike ${like} or ${inventoryItems.name} ilike ${like})`);
  where.push(sql`not exists (select 1 from assignments a where a.child_item_id = ${Q.itemId} and a.unassigned_at is null)`);
  const rows = await tx
    .select({
      id: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      status: inventoryItems.effectiveStatus,
      unit: inventoryItems.quantityUnit,
      locationName: locations.name,
    })
    .from(inventoryItems)
    .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
    .where(and(...where))
    .orderBy(sql`case when ${inventoryItems.locationId} = ${f.locationId} then 0 else 1 end`, asc(inventoryItems.code))
    .limit(60);
  const avail = await evaluateReservationAvailability(tx, ctx.orgId, rows.map((r) => r.id), {
    startsAt: f.startsAt,
    endsAt: f.endsAt,
    locationId: f.locationId,
  });
  return rows.map((r) => ({ ...r, ...avail.get(r.id)! }));
}

export type ReservationInput = {
  eventName: string;
  startsAt: string;
  endsAt: string;
  locationId: string;
  userId?: string | null;
  notes?: string | null;
  items: { itemId: string; quantity?: number }[];
};

export async function createReservation(tx: Tx, ctx: Ctx, input: ReservationInput) {
  const eventName = input.eventName?.trim();
  if (!eventName) throw new AppError("Event required", "Enter the event name.", "validation");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new AppError("Invalid time", "Enter a valid date, start time and end time.", "validation");
  }
  if (endsAt <= startsAt) throw new AppError("Invalid time", "The end time must be after the start time.", "validation");
  if (endsAt.getTime() < Date.now()) throw new AppError("Invalid time", "The reservation must end in the future.", "validation");
  const userId = input.userId || ctx.user.id;
  if (userId !== ctx.user.id && !ctx.can("reservation.manage_all")) throw new ForbiddenError("You can only reserve equipment for yourself.");
  const [loc] = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.id, input.locationId), eq(locations.organizationId, ctx.orgId)));
  if (!loc || !loc.isActive) throw new AppError("Invalid location", "Select an active location.", "validation");
  const unique = Array.from(new Map(input.items.map((i) => [i.itemId, i])).values());
  if (!unique.length) throw new AppError("No equipment", "Select at least one item to reserve.", "validation");

  // Serialize reservation writes per tenant; the exclusion constraint is the final guard.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"reserve:" + ctx.orgId}, 0))`);

  const items = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, ctx.orgId), inArray(inventoryItems.id, unique.map((u) => u.itemId))));
  if (items.length !== unique.length) throw new NotFoundError("inventory item");
  const qtyMap = new Map(
    unique.map((u) => {
      const it = items.find((i) => i.id === u.itemId)!;
      return [u.itemId, it.kind === "consumable" ? round(Number(u.quantity ?? 1)) : 1];
    }),
  );
  for (const [id, q] of qtyMap) {
    if (!(q > 0)) throw new AppError("Invalid quantity", `Enter a quantity for ${items.find((i) => i.id === id)?.code}.`, "validation");
  }
  const avail = await evaluateReservationAvailability(tx, ctx.orgId, items.map((i) => i.id), { startsAt, endsAt, locationId: loc.id }, qtyMap);
  const problems: string[] = [];
  for (const item of items) {
    const a = avail.get(item.id)!;
    if (a.availability !== "available") problems.push(`${item.code} ${item.name}: ${a.note ?? a.availability}`);
  }
  if (problems.length) {
    throw new AppError("Unable to reserve equipment", problems[0], "conflict", { details: problems });
  }

  const code = await nextCode(tx, ctx.orgId, "RSV");
  const [r] = await tx
    .insert(reservations)
    .values({
      organizationId: ctx.orgId,
      code,
      eventName: eventName.slice(0, 160),
      userId,
      createdBy: ctx.user.id,
      locationId: loc.id,
      startsAt,
      endsAt,
      notes: input.notes?.trim().slice(0, 1000) || null,
    })
    .returning();
  await tx.insert(reservationItems).values(
    items.map((i) => ({
      organizationId: ctx.orgId,
      reservationId: r.id,
      inventoryItemId: i.id,
      quantity: qtyMap.get(i.id)!,
      isTracked: i.kind !== "consumable",
      startsAt,
      endsAt,
    })),
  );
  await audit(tx, {
    organizationId: ctx.orgId,
    actorId: ctx.user.id,
    action: "reservation",
    entityType: "reservation",
    entityId: r.id,
    entityLabel: `${code} ${eventName}`,
    next: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      location: loc.name,
      items: items.map((i) => i.code),
    },
  });
  for (const i of items) {
    await audit(tx, {
      organizationId: ctx.orgId,
      actorId: ctx.user.id,
      action: "reservation",
      entityType: i.kind,
      entityId: i.id,
      entityLabel: `${i.code} ${i.name}`,
      next: { reservation: code, event: eventName, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    });
  }
  return r;
}

async function getReservationRow(tx: Tx, ctx: Ctx, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("reservation");
  const q = tx.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.organizationId, ctx.orgId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new NotFoundError("reservation");
  if (!ctx.can("reservation.manage_all") && row.userId !== ctx.user.id && row.createdBy !== ctx.user.id) {
    throw new NotFoundError("reservation");
  }
  return row;
}

export async function cancelReservation(tx: Tx, ctx: Ctx, id: string, reason: string | null) {
  const r = await getReservationRow(tx, ctx, id, true);
  if (r.status !== "confirmed") throw new AppError("Cannot cancel", `${r.code} is already ${r.status}.`, "state");
  await tx
    .update(reservations)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(reservations.id, id));
  await tx.update(reservationItems).set({ active: false }).where(eq(reservationItems.reservationId, id));
  await audit(tx, {
    organizationId: ctx.orgId,
    actorId: ctx.user.id,
    action: "reservation_cancel",
    entityType: "reservation",
    entityId: id,
    entityLabel: `${r.code} ${r.eventName}`,
    reason,
  });
}

export async function getReservationDetail(tx: Tx, ctx: Ctx, id: string) {
  const r = await getReservationRow(tx, ctx, id);
  const [meta] = await tx
    .select({ locationName: locations.name, userName: users.name })
    .from(reservations)
    .leftJoin(locations, eq(locations.id, reservations.locationId))
    .leftJoin(users, eq(users.id, reservations.userId))
    .where(eq(reservations.id, id));
  const items = await tx
    .select({
      id: reservationItems.id,
      itemId: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      status: inventoryItems.effectiveStatus,
      unit: inventoryItems.quantityUnit,
      quantity: reservationItems.quantity,
      active: reservationItems.active,
    })
    .from(reservationItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, reservationItems.inventoryItemId))
    .where(eq(reservationItems.reservationId, id))
    .orderBy(asc(inventoryItems.code));
  const [linked] = await tx
    .select({ id: checkouts.id, code: checkouts.code, status: checkouts.status })
    .from(checkouts)
    .where(and(eq(checkouts.reservationId, id), sql`${checkouts.status} <> 'cancelled'`));
  return { reservation: r, locationName: meta?.locationName ?? null, userName: meta?.userName ?? null, items, checkout: linked ?? null };
}

export async function listReservations(
  tx: Tx,
  ctx: Ctx,
  f: { scope?: "upcoming" | "past" | "cancelled" | "all"; q?: string; page?: number },
) {
  const page = Math.max(f.page ?? 1, 1);
  const pageSize = 20;
  const where: SQL[] = [eq(reservations.organizationId, ctx.orgId)];
  if (!ctx.can("reservation.manage_all")) {
    where.push(or(eq(reservations.userId, ctx.user.id), eq(reservations.createdBy, ctx.user.id))!);
  }
  if (f.scope === "upcoming" || !f.scope) where.push(gte(reservations.endsAt, new Date()), eq(reservations.status, "confirmed"));
  else if (f.scope === "past") where.push(or(lt(reservations.endsAt, new Date()), eq(reservations.status, "fulfilled"))!);
  else if (f.scope === "cancelled") where.push(eq(reservations.status, "cancelled"));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(${reservations.code} ilike ${like} or ${reservations.eventName} ilike ${like})`);
  }
  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(reservations).where(and(...where));
  const rows = await tx
    .select({
      id: reservations.id,
      code: reservations.code,
      eventName: reservations.eventName,
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
      status: reservations.status,
      locationName: locations.name,
      userName: users.name,
      itemCount: sql<number>`(select count(*)::int from reservation_items ri where ri.reservation_id = ${Q.reservationId})`,
    })
    .from(reservations)
    .leftJoin(locations, eq(locations.id, reservations.locationId))
    .leftJoin(users, eq(users.id, reservations.userId))
    .where(and(...where))
    .orderBy(f.scope === "past" ? desc(reservations.startsAt) : asc(reservations.startsAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
