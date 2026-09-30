import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { checkouts, inventoryItems, locations, reservations, users } from "@/db/schema";
import { CHECKOUT_STEPS } from "@/lib/domain";
import type { OrgContext } from "./auth/context";
import { visibilityFilter } from "./checkout";

type Ctx = Pick<OrgContext, "orgId" | "user" | "can" | "org">;

export async function getDashboard(tx: Tx, ctx: Ctx) {
  const vis = visibilityFilter(ctx);
  const activeWhere = and(
    eq(checkouts.organizationId, ctx.orgId),
    inArray(checkouts.status, ["active", "partially_returned"]),
    vis,
  );

  const activeSessions = await tx
    .select({
      id: checkouts.id,
      code: checkouts.code,
      eventName: checkouts.eventName,
      status: checkouts.status,
      startedAt: checkouts.startedAt,
      dueAt: checkouts.dueAt,
      locationName: locations.name,
      userName: users.name,
      itemsOut: sql<number>`(select count(*)::int from checkout_items ci where ci.checkout_id = ${checkouts.id} and ci.status = 'issued' and ci.parent_checkout_item_id is null)`,
    })
    .from(checkouts)
    .leftJoin(locations, eq(locations.id, checkouts.locationId))
    .leftJoin(users, eq(users.id, checkouts.userId))
    .where(activeWhere)
    .orderBy(desc(checkouts.startedAt))
    .limit(12);

  const [{ activeCount }] = await tx
    .select({ activeCount: sql<number>`count(*)::int` })
    .from(checkouts)
    .where(activeWhere);

  const [draft] = await tx
    .select({
      id: checkouts.id,
      code: checkouts.code,
      eventName: checkouts.eventName,
      currentStep: checkouts.currentStep,
      updatedAt: checkouts.updatedAt,
      locationName: locations.name,
      items: sql<number>`(select count(*)::int from checkout_items ci where ci.checkout_id = ${checkouts.id})`,
    })
    .from(checkouts)
    .leftJoin(locations, eq(locations.id, checkouts.locationId))
    .where(and(eq(checkouts.organizationId, ctx.orgId), eq(checkouts.status, "draft"), eq(checkouts.createdBy, ctx.user.id)))
    .orderBy(desc(checkouts.updatedAt))
    .limit(1);

  const [counts] = await tx
    .select({
      needsInspection: sql<number>`count(*) filter (where ${inventoryItems.effectiveStatus} = 'needs_inspection')::int`,
      missing: sql<number>`count(*) filter (where ${inventoryItems.status} = 'missing')::int`,
      rejected: sql<number>`count(*) filter (where ${inventoryItems.status} = 'rejected')::int`,
      lowStock: sql<number>`count(*) filter (where ${inventoryItems.kind} = 'consumable' and ${inventoryItems.reorderThreshold} is not null and exists (
        select 1 from consumable_stock cs where cs.inventory_item_id = ${inventoryItems.id}
        and (cs.total_quantity - cs.allocated_quantity - cs.issued_quantity) < ${inventoryItems.reorderThreshold}))::int`,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, ctx.orgId), isNull(inventoryItems.archivedAt)));

  const [{ overdue }] = await tx
    .select({ overdue: sql<number>`count(*)::int` })
    .from(checkouts)
    .where(and(activeWhere, sql`${checkouts.dueAt} < now()`));

  const upcoming = await tx
    .select({
      id: reservations.id,
      code: reservations.code,
      eventName: reservations.eventName,
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
      locationName: locations.name,
    })
    .from(reservations)
    .leftJoin(locations, eq(locations.id, reservations.locationId))
    .where(
      and(
        eq(reservations.organizationId, ctx.orgId),
        eq(reservations.status, "confirmed"),
        gte(reservations.endsAt, new Date()),
        ctx.can("reservation.manage_all") ? undefined : eq(reservations.userId, ctx.user.id),
      ),
    )
    .orderBy(reservations.startsAt)
    .limit(3);

  const stepLabel = draft ? CHECKOUT_STEPS[Math.min(Math.max(draft.currentStep, 1), 4) - 1].label : null;

  return {
    activeSessions,
    activeCount: Number(activeCount),
    inProgress: draft
      ? {
          ...draft,
          step: Math.min(Math.max(draft.currentStep, 1), 4),
          totalSteps: 4,
          stepLabel,
          context: draft.eventName ?? draft.locationName ?? "New checkout",
        }
      : null,
    alerts: {
      needsInspection: Number(counts?.needsInspection ?? 0),
      missing: Number(counts?.missing ?? 0),
      rejected: Number(counts?.rejected ?? 0),
      lowStock: Number(counts?.lowStock ?? 0),
      overdue: Number(overdue),
    },
    upcoming,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
