import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { inventoryItems, locations } from "@/db/schema";
import { locationSchema } from "@/lib/validators";
import type { OrgContext } from "./auth/context";
import { AppError, NotFoundError } from "./errors";
import { audit } from "./audit";

type Actor = Pick<OrgContext, "orgId" | "user">;

export async function listLocations(tx: Tx, orgId: string, opts: { activeOnly?: boolean } = {}) {
  return tx
    .select({
      id: locations.id,
      name: locations.name,
      code: locations.code,
      description: locations.description,
      address: locations.address,
      isActive: locations.isActive,
    })
    .from(locations)
    .where(and(eq(locations.organizationId, orgId), opts.activeOnly ? eq(locations.isActive, true) : undefined))
    .orderBy(asc(locations.name));
}

export async function locationStats(tx: Tx, orgId: string) {
  const rows = await tx.execute<{
    id: string;
    total: number;
    available: number;
    checked_out: number;
    needs_inspection: number;
    missing: number;
  }>(sql`
    select l.id,
      count(i.id)::int as total,
      count(i.id) filter (where i.effective_status = 'available' and not exists (
        select 1 from checkout_items ci where ci.inventory_item_id = i.id and ci.status = 'issued' and ci.is_tracked))::int as available,
      count(i.id) filter (where exists (
        select 1 from checkout_items ci where ci.inventory_item_id = i.id and ci.status = 'issued' and ci.is_tracked))::int as checked_out,
      count(i.id) filter (where i.effective_status = 'needs_inspection')::int as needs_inspection,
      count(i.id) filter (where i.status = 'missing')::int as missing
    from locations l
    left join inventory_items i on i.location_id = l.id and i.archived_at is null
    where l.organization_id = ${orgId}
    group by l.id
  `);
  return new Map(
    rows.rows.map((r) => [
      r.id,
      {
        total: Number(r.total),
        available: Number(r.available),
        checkedOut: Number(r.checked_out),
        needsInspection: Number(r.needs_inspection),
        missing: Number(r.missing),
      },
    ]),
  );
}

export async function getLocation(tx: Tx, orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("location");
  const [row] = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.id, id), eq(locations.organizationId, orgId)));
  if (!row) throw new NotFoundError("location");
  return row;
}

export async function createLocation(tx: Tx, actor: Actor, raw: unknown) {
  const v = locationSchema.parse(raw);
  const [row] = await tx
    .insert(locations)
    .values({ organizationId: actor.orgId, ...v })
    .returning();
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "create",
    entityType: "location",
    entityId: row.id,
    entityLabel: row.name,
    next: v,
  });
  return row;
}

export async function updateLocation(tx: Tx, actor: Actor, id: string, raw: unknown) {
  const existing = await getLocation(tx, actor.orgId, id);
  const v = locationSchema.parse(raw);
  if (!v.isActive && existing.isActive) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.locationId, id), isNull(inventoryItems.archivedAt)));
    if (Number(n) > 0) {
      throw new AppError(
        "Location in use",
        `Move the ${n} item(s) stored here before deactivating this location.`,
        "in_use",
      );
    }
  }
  await tx
    .update(locations)
    .set({ ...v, updatedAt: new Date() })
    .where(and(eq(locations.id, id), eq(locations.organizationId, actor.orgId)));
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "edit",
    entityType: "location",
    entityId: id,
    entityLabel: v.name,
    previous: { name: existing.name, code: existing.code, isActive: existing.isActive },
    next: v,
  });
}
