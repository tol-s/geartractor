import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import {
  checkoutItems,
  checkouts,
  consumableAllocations,
  consumableStock,
  inventoryItems,
  locations,
  reservationItems,
  reservations,
  users,
} from "@/db/schema";
import { KIND_LABEL, STATUS_LABEL, type InventoryKind } from "@/lib/domain";
import type { Reason } from "@/lib/status-rules";
import { formatQty } from "@/lib/utils";
import type { OrgContext } from "./auth/context";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { audit, recordStatusChange } from "./audit";
import { nextCode } from "./codes";
import { adjustStock, lockStock } from "./consumables";
import { getAncestors, getDescendants, getItemOrThrow } from "./inventory";
import { ensureFreshStatuses, orgToday, recomputeOrgStatuses } from "./status-engine";
import { resolveScan } from "./qr";

type Ctx = Pick<OrgContext, "orgId" | "user" | "can" | "org">;

const DEFAULT_CHECKOUT_DAYS = 7;
const round = (n: number) => Math.round(n * 1000) / 1000;

/* ------------------------------------------------------------------ */
/* Human-readable blocking messages                                    */
/* ------------------------------------------------------------------ */

function reasonPhrase(r: Reason): string {
  switch (r.code) {
    case "inspection_overdue":
      return "its annual inspection is overdue";
    case "inspection_missing":
      return "it has no inspection on record";
    case "expired":
      return `it ${r.label.toLowerCase()}`;
    case "expiry_info_missing":
      return "its expiry information is missing";
    case "missing":
      return "it is reported missing";
    case "rejected":
      return "it has been rejected";
    case "flagged":
      return "it is flagged for inspection";
    case "consumable_shortage":
      return `of a ${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}`;
    case "child":
      return `${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}`;
  }
}

export function blockedMessage(code: string, reasons: Reason[]): string {
  const primary = reasons[0];
  if (!primary) return `${code} cannot be checked out.`;
  return `${code} cannot be checked out because ${reasonPhrase(primary)}.`;
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

export type CheckoutEligibility = {
  eligible: boolean;
  /** Short labels, e.g. "Needs Inspection", "Reserved". */
  flags: string[];
  /** Full sentences for error messages. */
  messages: string[];
  overridableReservation?: { code: string; eventName: string } | null;
  unallocated?: number | null;
  parentPath?: { id: string; code: string; name: string; kind: InventoryKind }[];
};

export async function evaluateCheckoutEligibility(
  tx: Tx,
  orgId: string,
  itemIds: string[],
  opts: {
    locationId: string | null;
    windowStart: Date;
    windowEnd: Date;
    reservationId?: string | null;
    checkoutId?: string | null;
    quantities?: Map<string, number>;
  },
): Promise<Map<string, CheckoutEligibility>> {
  const result = new Map<string, CheckoutEligibility>();
  if (!itemIds.length) return result;
  const items = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, orgId), inArray(inventoryItems.id, itemIds)));

  const assigned = await tx.execute<{ child_item_id: string }>(sql`
    select child_item_id from assignments where unassigned_at is null and organization_id = ${orgId}
    and child_item_id in (${sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `)})
  `);
  const assignedSet = new Set(assigned.rows.map((r) => r.child_item_id));

  const issued = await tx.execute<{ inventory_item_id: string; code: string; checkout_id: string }>(sql`
    select ci.inventory_item_id, c.code, c.id as checkout_id from checkout_items ci join checkouts c on c.id = ci.checkout_id
    where ci.status = 'issued' and ci.is_tracked and ci.organization_id = ${orgId}
    and ci.inventory_item_id in (${sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `)})
  `);
  const issuedMap = new Map(issued.rows.map((r) => [r.inventory_item_id, r]));

  const reserved = await tx.execute<{ inventory_item_id: string; code: string; event_name: string; reservation_id: string; quantity: number }>(sql`
    select ri.inventory_item_id, r.code, r.event_name, r.id as reservation_id, ri.quantity::float8 as quantity
    from reservation_items ri join reservations r on r.id = ri.reservation_id
    where ri.active and ri.organization_id = ${orgId}
      and tstzrange(ri.starts_at, ri.ends_at, '[)') && tstzrange(${opts.windowStart.toISOString()}::timestamptz, ${opts.windowEnd.toISOString()}::timestamptz, '[)')
      and ri.inventory_item_id in (${sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `)})
      ${opts.reservationId ? sql`and ri.reservation_id <> ${opts.reservationId}` : sql``}
  `);

  const stocks = await tx
    .select()
    .from(consumableStock)
    .where(inArray(consumableStock.inventoryItemId, itemIds));
  const stockMap = new Map(stocks.map((s) => [s.inventoryItemId, s]));

  for (const item of items) {
    const flags: string[] = [];
    const messages: string[] = [];
    let overridable: CheckoutEligibility["overridableReservation"] = null;
    let unallocated: number | null = null;
    let parentPath: CheckoutEligibility["parentPath"];

    if (item.archivedAt) {
      flags.push("Archived");
      messages.push(`${item.code} is archived.`);
    }
    if (assignedSet.has(item.id)) {
      parentPath = await getAncestors(tx, orgId, item.id);
      const top = parentPath[parentPath.length - 1];
      const direct = parentPath[0];
      flags.push("Assigned");
      messages.push(
        `${item.code} is assigned to ${KIND_LABEL[direct.kind]} ${direct.code} and cannot be checked out on its own. Check out ${top.code} instead.`,
      );
    }
    if (item.checkoutBlocked) {
      const reasons = item.statusReasons ?? [];
      flags.push(item.effectiveStatus !== "available" ? STATUS_LABEL[item.effectiveStatus] : "Blocked");
      messages.push(blockedMessage(item.code, reasons));
    }
    if (opts.locationId && item.locationId !== opts.locationId) {
      flags.push("Other location");
      messages.push(`${item.code} is stored at a different location than this checkout.`);
    }
    if (item.kind === "consumable") {
      const s = stockMap.get(item.id);
      unallocated = s ? round(s.totalQuantity - s.allocatedQuantity - s.issuedQuantity) : 0;
      // Consumable reservations for other sessions reduce what can be issued now.
      const reservedQty = reserved.rows
        .filter((r) => r.inventory_item_id === item.id)
        .reduce((sum, r) => sum + Number(r.quantity), 0);
      const free = round(unallocated - reservedQty);
      const want = opts.quantities?.get(item.id) ?? 0;
      if (free <= 0) {
        flags.push("Insufficient Stock");
        messages.push(`${item.code} has no unallocated stock available.`);
      } else if (want > free) {
        flags.push("Insufficient Stock");
        messages.push(`Only ${formatQty(free, item.quantityUnit)} of ${item.code} is available.`);
      }
      unallocated = free;
    } else {
      const out = issuedMap.get(item.id);
      if (out && out.checkout_id !== opts.checkoutId) {
        flags.push("Checked Out");
        messages.push(`${item.code} is already checked out on ${out.code}.`);
      }
      const conflict = reserved.rows.find((r) => r.inventory_item_id === item.id);
      if (conflict) {
        flags.push("Reserved");
        overridable = { code: conflict.code, eventName: conflict.event_name };
        messages.push(`${item.code} is reserved for ${conflict.event_name} (${conflict.code}).`);
      }
    }
    result.set(item.id, {
      eligible: messages.length === 0,
      flags,
      messages,
      overridableReservation: overridable,
      unallocated,
      parentPath,
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

async function getCheckoutRow(tx: Tx, ctx: Ctx, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("checkout");
  const q = tx
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.id, id), eq(checkouts.organizationId, ctx.orgId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new NotFoundError("checkout");
  if (!ctx.can("checkout.manage_all") && row.createdBy !== ctx.user.id && row.userId !== ctx.user.id) {
    throw new NotFoundError("checkout");
  }
  return row;
}

async function getDraft(tx: Tx, ctx: Ctx, id: string) {
  const row = await getCheckoutRow(tx, ctx, id, true);
  if (row.status !== "draft") {
    throw new AppError("Checkout already confirmed", `${row.code} is no longer in progress.`, "not_draft", {
      href: `/checkouts/${row.id}`,
    });
  }
  return row;
}

function defaultDue(ctx: Ctx) {
  const days = ctx.org.settings?.defaultCheckoutDays ?? DEFAULT_CHECKOUT_DAYS;
  return new Date(Date.now() + days * 86400_000);
}

export async function createDraftCheckout(tx: Tx, ctx: Ctx, input: { reservationId?: string | null } = {}) {
  const code = await nextCode(tx, ctx.orgId, "CHK");
  let values: Partial<typeof checkouts.$inferInsert> = {};
  let reservationItemsToAdd: { itemId: string; quantity: number; isTracked: boolean }[] = [];
  if (input.reservationId) {
    const [r] = await tx
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, input.reservationId), eq(reservations.organizationId, ctx.orgId)))
      .for("update");
    if (!r || r.status !== "confirmed") throw new NotFoundError("reservation");
    if (!ctx.can("reservation.manage_all") && r.userId !== ctx.user.id && r.createdBy !== ctx.user.id) {
      throw new ForbiddenError();
    }
    const existing = await tx
      .select({ id: checkouts.id })
      .from(checkouts)
      .where(and(eq(checkouts.reservationId, r.id), inArray(checkouts.status, ["draft", "active", "partially_returned"])));
    if (existing.length) {
      throw new AppError("Checkout exists", "A checkout already exists for this reservation.", "duplicate", {
        href: `/checkouts/${existing[0].id}`,
      });
    }
    values = {
      eventName: r.eventName,
      userId: r.userId,
      locationId: r.locationId,
      reservationId: r.id,
      dueAt: r.endsAt,
      currentStep: 4,
    };
    const items = await tx
      .select()
      .from(reservationItems)
      .where(and(eq(reservationItems.reservationId, r.id), eq(reservationItems.active, true)));
    reservationItemsToAdd = items.map((i) => ({ itemId: i.inventoryItemId, quantity: i.quantity, isTracked: i.isTracked }));
  }
  const [row] = await tx
    .insert(checkouts)
    .values({
      organizationId: ctx.orgId,
      code,
      createdBy: ctx.user.id,
      userId: ctx.user.id,
      status: "draft",
      currentStep: 1,
      dueAt: defaultDue(ctx),
      ...values,
    })
    .returning();
  for (const i of reservationItemsToAdd) {
    await tx.insert(checkoutItems).values({
      organizationId: ctx.orgId,
      checkoutId: row.id,
      inventoryItemId: i.itemId,
      isTracked: i.isTracked,
      quantity: i.quantity,
      status: "pending",
      addedBy: ctx.user.id,
    });
  }
  return row;
}

export async function updateDraftDetails(
  tx: Tx,
  ctx: Ctx,
  id: string,
  input: { step: 1 | 2 | 3; eventName?: string; dueAt?: string | null; notes?: string | null; userId?: string; locationId?: string },
) {
  const draft = await getDraft(tx, ctx, id);
  const patch: Partial<typeof checkouts.$inferInsert> = { updatedAt: new Date() };
  let removed: string[] = [];
  if (input.step === 1) {
    const name = (input.eventName ?? "").trim();
    if (!name) throw new AppError("Event required", "Enter the event or session name.", "validation");
    patch.eventName = name.slice(0, 160);
    patch.notes = input.notes?.trim().slice(0, 1000) || null;
    if (input.dueAt) {
      const due = new Date(input.dueAt);
      if (Number.isNaN(due.getTime()) || due.getTime() < Date.now() - 60_000) {
        throw new AppError("Invalid return date", "The expected return must be in the future.", "validation");
      }
      patch.dueAt = due;
    }
  } else if (input.step === 2) {
    const userId = input.userId ?? ctx.user.id;
    if (userId !== ctx.user.id && !ctx.can("checkout.assign_user")) {
      throw new ForbiddenError("You can only check out equipment for yourself.");
    }
    const [u] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, ctx.orgId)));
    if (!u && userId !== ctx.user.id) throw new AppError("Invalid user", "Select an active trainer or user.", "validation");
    if (u && u.status !== "active") throw new AppError("User inactive", "This user is not active.", "validation");
    patch.userId = userId;
  } else if (input.step === 3) {
    if (!input.locationId) throw new AppError("Location required", "Select the storage location.", "validation");
    const [loc] = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.id, input.locationId), eq(locations.organizationId, ctx.orgId)));
    if (!loc || !loc.isActive) throw new AppError("Invalid location", "Select an active storage location.", "validation");
    patch.locationId = loc.id;
    if (draft.locationId && draft.locationId !== loc.id) {
      // Remove basket items stored elsewhere (location is enforced during checkout).
      const pending = await tx
        .select({ id: checkoutItems.id, code: inventoryItems.code, locationId: inventoryItems.locationId })
        .from(checkoutItems)
        .innerJoin(inventoryItems, eq(inventoryItems.id, checkoutItems.inventoryItemId))
        .where(eq(checkoutItems.checkoutId, id));
      const toRemove = pending.filter((p) => p.locationId !== loc.id);
      if (toRemove.length) {
        await tx.delete(checkoutItems).where(inArray(checkoutItems.id, toRemove.map((r) => r.id)));
        removed = toRemove.map((r) => r.code);
      }
    }
  }
  patch.currentStep = Math.max(draft.currentStep, input.step + 1);
  await tx.update(checkouts).set(patch).where(eq(checkouts.id, id));
  return { removed };
}

export async function cancelDraft(tx: Tx, ctx: Ctx, id: string) {
  const draft = await getDraft(tx, ctx, id);
  await tx.delete(checkoutItems).where(eq(checkoutItems.checkoutId, id));
  await tx
    .update(checkouts)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(checkouts.id, draft.id));
}

/* ------------------------------------------------------------------ */
/* Basket                                                              */
/* ------------------------------------------------------------------ */

function checkoutWindow(draft: typeof checkouts.$inferSelect, ctx: Ctx) {
  const start = new Date();
  const end = draft.dueAt && draft.dueAt > start ? draft.dueAt : defaultDue(ctx);
  return { start, end };
}

export async function addToBasket(
  tx: Tx,
  ctx: Ctx,
  checkoutId: string,
  input: { itemId?: string; scan?: string; quantity?: number; override?: boolean },
): Promise<{ added: boolean; duplicate: boolean; itemId: string; code: string; name: string }> {
  const draft = await getDraft(tx, ctx, checkoutId);
  let itemId = input.itemId ?? null;
  if (!itemId && input.scan) {
    itemId = await resolveScan(tx, ctx.orgId, input.scan);
    if (!itemId) {
      throw new AppError("Code not recognised", "This QR code does not match any equipment in your organization.", "not_found");
    }
  }
  if (!itemId) throw new AppError("Nothing to add", "Select or scan equipment.", "validation");
  const item = await getItemOrThrow(tx, ctx.orgId, itemId);

  const [existing] = await tx
    .select()
    .from(checkoutItems)
    .where(and(eq(checkoutItems.checkoutId, checkoutId), eq(checkoutItems.inventoryItemId, itemId)));
  if (existing) {
    // Repeated scans never duplicate basket lines.
    return { added: false, duplicate: true, itemId, code: item.code, name: item.name };
  }
  if (!draft.locationId) {
    throw new AppError("Select a location first", "Choose the storage location before adding equipment.", "validation");
  }
  const quantity = item.kind === "consumable" ? round(Number(input.quantity ?? 1)) : 1;
  if (!(quantity > 0)) throw new AppError("Invalid quantity", "Quantity must be greater than zero.", "validation");
  const { start, end } = checkoutWindow(draft, ctx);
  const verdict = (
    await evaluateCheckoutEligibility(tx, ctx.orgId, [itemId], {
      locationId: draft.locationId,
      windowStart: start,
      windowEnd: end,
      reservationId: draft.reservationId,
      checkoutId,
      quantities: new Map([[itemId, quantity]]),
    })
  ).get(itemId)!;
  const onlyReservation = verdict.flags.length === 1 && verdict.flags[0] === "Reserved";
  const canOverride =
    onlyReservation && input.override && ctx.can("reservation.override") && ctx.org.settings?.allowReservedOverride;
  if (!verdict.eligible && !canOverride) {
    throw new AppError("Unable to checkout equipment", verdict.messages[0], "not_eligible", {
      itemId,
      itemCode: item.code,
      href: `/inventory/${itemId}`,
      details: verdict.messages,
    });
  }
  await tx.insert(checkoutItems).values({
    organizationId: ctx.orgId,
    checkoutId,
    inventoryItemId: itemId,
    isTracked: item.kind !== "consumable",
    quantity,
    status: "pending",
    addedBy: ctx.user.id,
  });
  await tx
    .update(checkouts)
    .set({ currentStep: 4, updatedAt: new Date() })
    .where(eq(checkouts.id, checkoutId));
  return { added: true, duplicate: false, itemId, code: item.code, name: item.name };
}

export async function removeFromBasket(tx: Tx, ctx: Ctx, checkoutId: string, lineId: string) {
  await getDraft(tx, ctx, checkoutId);
  await tx
    .delete(checkoutItems)
    .where(and(eq(checkoutItems.id, lineId), eq(checkoutItems.checkoutId, checkoutId)));
}

export async function updateBasketQuantity(tx: Tx, ctx: Ctx, checkoutId: string, lineId: string, quantity: number) {
  const draft = await getDraft(tx, ctx, checkoutId);
  const [line] = await tx
    .select()
    .from(checkoutItems)
    .where(and(eq(checkoutItems.id, lineId), eq(checkoutItems.checkoutId, checkoutId)));
  if (!line) throw new NotFoundError("basket item");
  if (line.isTracked) return;
  const q = round(quantity);
  if (!(q > 0)) throw new AppError("Invalid quantity", "Quantity must be greater than zero.", "validation");
  const { start, end } = checkoutWindow(draft, ctx);
  const verdict = (
    await evaluateCheckoutEligibility(tx, ctx.orgId, [line.inventoryItemId], {
      locationId: draft.locationId,
      windowStart: start,
      windowEnd: end,
      reservationId: draft.reservationId,
      checkoutId,
      quantities: new Map([[line.inventoryItemId, q]]),
    })
  ).get(line.inventoryItemId)!;
  if (!verdict.eligible) throw new AppError("Insufficient stock", verdict.messages[0], "insufficient_stock");
  await tx.update(checkoutItems).set({ quantity: q }).where(eq(checkoutItems.id, lineId));
}

/* ------------------------------------------------------------------ */
/* Confirm (transactional)                                             */
/* ------------------------------------------------------------------ */

export async function confirmCheckout(
  tx: Tx,
  ctx: Ctx,
  checkoutId: string,
  opts: { overrideReason?: string | null } = {},
) {
  await ensureFreshStatuses(tx, ctx.orgId);
  const draft = await getDraft(tx, ctx, checkoutId);
  if (!draft.eventName) throw new AppError("Event required", "Enter the event or session first.", "validation");
  if (!draft.locationId) throw new AppError("Location required", "Select the storage location first.", "validation");
  if (!draft.userId) throw new AppError("Trainer required", "Select the trainer or user.", "validation");

  const lines = await tx
    .select()
    .from(checkoutItems)
    .where(and(eq(checkoutItems.checkoutId, checkoutId), eq(checkoutItems.status, "pending")));
  if (!lines.length) throw new AppError("Basket is empty", "Add equipment before confirming the checkout.", "validation");

  // Expand assemblies: every tracked descendant is included exactly once.
  const expansions = new Map<string, Awaited<ReturnType<typeof getDescendants>>>();
  for (const line of lines) {
    const item = await getItemOrThrow(tx, ctx.orgId, line.inventoryItemId);
    if (item.kind === "configuration" || item.kind === "kit") {
      expansions.set(line.inventoryItemId, await getDescendants(tx, ctx.orgId, line.inventoryItemId));
    }
  }
  const allTracked = new Set<string>();
  for (const line of lines) if (line.isTracked) allTracked.add(line.inventoryItemId);
  for (const desc of expansions.values()) for (const d of desc) {
    if (allTracked.has(d.id)) {
      throw new AppError("Duplicate equipment", `${d.code} is included more than once in this checkout.`, "duplicate");
    }
    allTracked.add(d.id);
  }

  // Row locks (sorted to avoid deadlocks). Concurrent checkouts of the same equipment serialize here.
  const lockIds = Array.from(allTracked).sort();
  if (lockIds.length) {
    await tx.execute(sql`
      select id from inventory_items where organization_id = ${ctx.orgId}
      and id in (${sql.join(lockIds.map((i) => sql`${i}::uuid`), sql`, `)}) order by id for update
    `);
  }
  const consumableLines = lines.filter((l) => !l.isTracked);
  for (const l of consumableLines.sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId))) {
    await lockStock(tx, ctx.orgId, l.inventoryItemId);
  }

  const { start, end } = checkoutWindow(draft, ctx);
  const verdicts = await evaluateCheckoutEligibility(tx, ctx.orgId, lines.map((l) => l.inventoryItemId), {
    locationId: draft.locationId,
    windowStart: start,
    windowEnd: end,
    reservationId: draft.reservationId,
    checkoutId,
    quantities: new Map(consumableLines.map((l) => [l.inventoryItemId, l.quantity])),
  });

  // Descendants must not be issued elsewhere either.
  const descendantIds = lockIds.filter((id) => !lines.some((l) => l.inventoryItemId === id));
  const descendantIssued = descendantIds.length
    ? await tx.execute<{ code: string; checkout: string }>(sql`
        select i.code, c.code as checkout from checkout_items ci
        join inventory_items i on i.id = ci.inventory_item_id join checkouts c on c.id = ci.checkout_id
        where ci.status = 'issued' and ci.is_tracked
        and ci.inventory_item_id in (${sql.join(descendantIds.map((i) => sql`${i}::uuid`), sql`, `)})`)
    : { rows: [] as { code: string; checkout: string }[] };

  const problems: string[] = [];
  const overrides: string[] = [];
  for (const line of lines) {
    const v = verdicts.get(line.inventoryItemId);
    if (!v) continue;
    if (v.eligible) continue;
    const onlyReservation = v.flags.length === 1 && v.flags[0] === "Reserved";
    if (
      onlyReservation &&
      opts.overrideReason?.trim() &&
      ctx.can("reservation.override") &&
      ctx.org.settings?.allowReservedOverride
    ) {
      overrides.push(v.messages[0]);
      continue;
    }
    problems.push(...v.messages);
  }
  for (const r of descendantIssued.rows) problems.push(`${r.code} is already checked out on ${r.checkout}.`);
  if (problems.length) {
    const firstLine = lines.find((l) => !verdicts.get(l.inventoryItemId)?.eligible);
    throw new AppError("Unable to checkout equipment", problems[0], "not_eligible", {
      itemId: firstLine?.inventoryItemId,
      href: firstLine ? `/inventory/${firstLine.inventoryItemId}` : undefined,
      details: problems,
    });
  }

  const today = await orgToday(tx, ctx.orgId);

  // Issue root lines.
  await tx
    .update(checkoutItems)
    .set({ status: "issued" })
    .where(and(eq(checkoutItems.checkoutId, checkoutId), eq(checkoutItems.status, "pending")));

  // Issue descendants and allocated consumables under their parent lines.
  for (const line of lines) {
    const desc = expansions.get(line.inventoryItemId);
    if (!desc) continue;
    const lineByItem = new Map<string, string>([[line.inventoryItemId, line.id]]);
    for (const d of desc) {
      const [row] = await tx
        .insert(checkoutItems)
        .values({
          organizationId: ctx.orgId,
          checkoutId,
          inventoryItemId: d.id,
          parentCheckoutItemId: lineByItem.get(d.parentId) ?? line.id,
          isTracked: true,
          quantity: 1,
          status: "issued",
          addedBy: ctx.user.id,
        })
        .returning({ id: checkoutItems.id });
      lineByItem.set(d.id, row.id);
    }
    const assemblyIds = [line.inventoryItemId, ...desc.filter((d) => d.kind !== "component").map((d) => d.id)];
    const allocs = await tx
      .select()
      .from(consumableAllocations)
      .where(and(inArray(consumableAllocations.parentItemId, assemblyIds), isNull(consumableAllocations.releasedAt)));
    for (const a of allocs) {
      if (a.allocatedQuantity <= 0) continue;
      await tx.insert(checkoutItems).values({
        organizationId: ctx.orgId,
        checkoutId,
        inventoryItemId: a.consumableItemId,
        parentCheckoutItemId: lineByItem.get(a.parentItemId) ?? line.id,
        isTracked: false,
        quantity: a.allocatedQuantity,
        status: "issued",
        addedBy: ctx.user.id,
      });
    }
  }

  // Directly issued consumables leave unallocated stock.
  for (const l of consumableLines) {
    await adjustStock(tx, ctx, l.inventoryItemId, {
      type: "issue",
      delta: l.quantity,
      note: `Issued on ${draft.code}`,
      referenceType: "checkout",
      referenceId: checkoutId,
    });
  }

  // Usage dates.
  if (lockIds.length) {
    await tx.execute(sql`
      update inventory_items set last_use_date = ${today}::date, first_use_date = coalesce(first_use_date, ${today}::date), updated_at = now()
      where organization_id = ${ctx.orgId} and id in (${sql.join(lockIds.map((i) => sql`${i}::uuid`), sql`, `)})
    `);
  }

  await tx
    .update(checkouts)
    .set({ status: "active", startedAt: new Date(), currentStep: 4, updatedAt: new Date() })
    .where(eq(checkouts.id, checkoutId));

  if (draft.reservationId) {
    await tx
      .update(reservations)
      .set({ status: "fulfilled", updatedAt: new Date() })
      .where(eq(reservations.id, draft.reservationId));
    await tx
      .update(reservationItems)
      .set({ active: false })
      .where(eq(reservationItems.reservationId, draft.reservationId));
  }

  const summary = await tx
    .select({ code: inventoryItems.code, name: inventoryItems.name, kind: inventoryItems.kind, quantity: checkoutItems.quantity })
    .from(checkoutItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, checkoutItems.inventoryItemId))
    .where(eq(checkoutItems.checkoutId, checkoutId));
  await audit(tx, {
    organizationId: ctx.orgId,
    actorId: ctx.user.id,
    action: "checkout",
    entityType: "checkout",
    entityId: checkoutId,
    entityLabel: `${draft.code} ${draft.eventName}`,
    next: { items: summary.map((s) => `${s.code} ${s.name}`), overrides },
    reason: overrides.length ? opts.overrideReason ?? null : null,
  });
  for (const line of lines) {
    const item = await getItemOrThrow(tx, ctx.orgId, line.inventoryItemId);
    await audit(tx, {
      organizationId: ctx.orgId,
      actorId: ctx.user.id,
      action: "checkout",
      entityType: item.kind,
      entityId: item.id,
      entityLabel: `${item.code} ${item.name}`,
      next: { checkout: draft.code, event: draft.eventName, quantity: line.quantity },
    });
  }
  await recomputeOrgStatuses(tx, ctx.orgId, { actorId: ctx.user.id });
  return { id: checkoutId, code: draft.code, itemCount: summary.length };
}

/* ------------------------------------------------------------------ */
/* Returns (check-in)                                                  */
/* ------------------------------------------------------------------ */

export type ReturnLineInput = {
  checkoutItemId: string;
  outcome: "returned" | "missing" | "damaged" | "exception";
  note?: string | null;
  unused?: number;
  consumed?: number;
  lost?: number;
};

export async function processReturn(tx: Tx, ctx: Ctx, checkoutId: string, input: ReturnLineInput[]) {
  const checkout = await getCheckoutRow(tx, ctx, checkoutId, true);
  if (checkout.status !== "active" && checkout.status !== "partially_returned") {
    throw new AppError("Nothing to return", `${checkout.code} has no outstanding equipment.`, "not_active");
  }
  if (!input.length) throw new AppError("Nothing selected", "Select the equipment being returned.", "validation");

  const lines = await tx
    .select({
      line: checkoutItems,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      unit: inventoryItems.quantityUnit,
      baseStatus: inventoryItems.status,
    })
    .from(checkoutItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, checkoutItems.inventoryItemId))
    .where(eq(checkoutItems.checkoutId, checkoutId))
    .for("update", { of: checkoutItems });
  const byId = new Map(lines.map((l) => [l.line.id, l]));
  const processing = new Map(input.map((i) => [i.checkoutItemId, i]));

  // Validate structure: an assembly returns together with its outstanding contents,
  // and contents cannot come back while their parent stays out.
  for (const i of input) {
    const l = byId.get(i.checkoutItemId);
    if (!l) throw new NotFoundError("checkout line");
    if (l.line.status !== "issued") {
      throw new AppError("Already processed", `${l.code} has already been checked in.`, "processed");
    }
    const parentId = l.line.parentCheckoutItemId;
    if (parentId) {
      const parent = byId.get(parentId);
      if (parent && parent.line.status === "issued" && !processing.has(parentId)) {
        throw new AppError(
          "Return the assembly",
          `${l.code} is part of ${parent.code}. Check in ${parent.code} to return its contents.`,
          "structure",
        );
      }
    }
  }
  for (const l of lines) {
    if (l.line.status !== "issued" || !l.line.parentCheckoutItemId) continue;
    if (processing.has(l.line.parentCheckoutItemId) && !processing.has(l.line.id)) {
      const parent = byId.get(l.line.parentCheckoutItemId)!;
      throw new AppError(
        "Account for all contents",
        `Record an outcome for ${l.code} when checking in ${parent.code}.`,
        "structure",
      );
    }
  }

  const today = await orgToday(tx, ctx.orgId);
  const results: { code: string; outcome: string }[] = [];

  for (const i of input) {
    const l = byId.get(i.checkoutItemId)!;
    const note = i.note?.trim().slice(0, 500) || null;
    if (!l.line.isTracked) {
      const unused = round(Number(i.unused ?? 0));
      const consumed = round(Number(i.consumed ?? 0));
      const lost = round(Number(i.lost ?? 0));
      if ([unused, consumed, lost].some((n) => !(n >= 0))) {
        throw new AppError("Invalid quantities", `Enter valid quantities for ${l.code}.`, "validation");
      }
      if (Math.abs(unused + consumed + lost - l.line.quantity) > 0.0005) {
        throw new AppError(
          "Quantities do not add up",
          `${l.code}: unused, consumed and loss must add up to ${formatQty(l.line.quantity, l.unit)}.`,
          "validation",
        );
      }
      await lockStock(tx, ctx.orgId, l.line.inventoryItemId);
      const viaAssembly = Boolean(l.line.parentCheckoutItemId);
      const bucket = viaAssembly ? "allocated" : "issued";
      const ref = { referenceType: "checkout", referenceId: checkoutId };
      if (unused > 0) await adjustStock(tx, ctx, l.line.inventoryItemId, { type: "return_unused", delta: unused, bucket, note: `Unused return ${checkout.code}`, ...ref });
      if (consumed > 0) await adjustStock(tx, ctx, l.line.inventoryItemId, { type: "consumed", delta: consumed, bucket, note: `Consumed on ${checkout.code}`, ...ref });
      if (lost > 0) await adjustStock(tx, ctx, l.line.inventoryItemId, { type: "loss", delta: lost, bucket, note: note ?? `Loss on ${checkout.code}`, ...ref });
      if (viaAssembly && consumed + lost > 0) {
        const parentLine = byId.get(l.line.parentCheckoutItemId!)!;
        await tx
          .update(consumableAllocations)
          .set({ allocatedQuantity: sql`greatest(${consumableAllocations.allocatedQuantity} - ${consumed + lost}, 0)` })
          .where(
            and(
              eq(consumableAllocations.parentItemId, parentLine.line.inventoryItemId),
              eq(consumableAllocations.consumableItemId, l.line.inventoryItemId),
              isNull(consumableAllocations.releasedAt),
            ),
          );
      }
      await tx
        .update(checkoutItems)
        .set({
          status: "returned",
          returnedUnused: unused,
          consumed,
          lost,
          returnNote: note,
          returnedAt: new Date(),
          returnedBy: ctx.user.id,
        })
        .where(eq(checkoutItems.id, l.line.id));
      results.push({ code: l.code, outcome: `unused ${unused}, consumed ${consumed}, loss ${lost}` });
      continue;
    }

    await tx
      .update(checkoutItems)
      .set({ status: i.outcome, returnNote: note, returnedAt: new Date(), returnedBy: ctx.user.id })
      .where(eq(checkoutItems.id, l.line.id));
    await tx
      .update(inventoryItems)
      .set({ lastUseDate: today, updatedAt: new Date() })
      .where(eq(inventoryItems.id, l.line.inventoryItemId));

    const newStatus =
      i.outcome === "missing" ? "missing" : i.outcome === "damaged" || i.outcome === "exception" ? "needs_inspection" : null;
    if (newStatus && newStatus !== l.baseStatus) {
      const reason =
        i.outcome === "missing"
          ? `Not returned on ${checkout.code}${note ? `: ${note}` : ""}`
          : i.outcome === "damaged"
            ? `Returned damaged on ${checkout.code}${note ? `: ${note}` : ""}`
            : `Return exception on ${checkout.code}${note ? `: ${note}` : ""}`;
      await tx
        .update(inventoryItems)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(inventoryItems.id, l.line.inventoryItemId));
      await recordStatusChange(tx, {
        organizationId: ctx.orgId,
        itemId: l.line.inventoryItemId,
        previous: l.baseStatus,
        next: newStatus,
        reason,
        source: "return",
        userId: ctx.user.id,
      });
      await audit(tx, {
        organizationId: ctx.orgId,
        actorId: ctx.user.id,
        action: "status_change",
        entityType: l.kind,
        entityId: l.line.inventoryItemId,
        entityLabel: `${l.code} ${l.name}`,
        previous: { status: STATUS_LABEL[l.baseStatus] },
        next: { status: STATUS_LABEL[newStatus] },
        reason,
      });
    }
    await audit(tx, {
      organizationId: ctx.orgId,
      actorId: ctx.user.id,
      action: "return",
      entityType: l.kind,
      entityId: l.line.inventoryItemId,
      entityLabel: `${l.code} ${l.name}`,
      next: { checkout: checkout.code, outcome: i.outcome },
      reason: note,
    });
    results.push({ code: l.code, outcome: i.outcome });
  }

  const [{ remaining }] = await tx
    .select({ remaining: sql<number>`count(*)::int` })
    .from(checkoutItems)
    .where(and(eq(checkoutItems.checkoutId, checkoutId), eq(checkoutItems.status, "issued")));
  const done = Number(remaining) === 0;
  await tx
    .update(checkouts)
    .set({
      status: done ? "returned" : "partially_returned",
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(checkouts.id, checkoutId));
  await audit(tx, {
    organizationId: ctx.orgId,
    actorId: ctx.user.id,
    action: "return",
    entityType: "checkout",
    entityId: checkoutId,
    entityLabel: `${checkout.code} ${checkout.eventName ?? ""}`.trim(),
    next: { lines: results, remaining: Number(remaining) },
  });
  await recomputeOrgStatuses(tx, ctx.orgId, { actorId: ctx.user.id, source: "return" });
  return { done, remaining: Number(remaining), processed: results.length };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function visibilityFilter(ctx: Ctx): SQL | undefined {
  if (ctx.can("checkout.manage_all")) return undefined;
  return or(eq(checkouts.createdBy, ctx.user.id), eq(checkouts.userId, ctx.user.id));
}

export async function getCheckoutDetail(tx: Tx, ctx: Ctx, id: string) {
  const row = await getCheckoutRow(tx, ctx, id);
  const [meta] = await tx
    .select({ locationName: locations.name, userName: users.name })
    .from(checkouts)
    .leftJoin(locations, eq(locations.id, checkouts.locationId))
    .leftJoin(users, eq(users.id, checkouts.userId))
    .where(eq(checkouts.id, id));
  const [creator] = await tx.select({ name: users.name }).from(users).where(eq(users.id, row.createdBy));
  const lines = await tx
    .select({
      id: checkoutItems.id,
      parentId: checkoutItems.parentCheckoutItemId,
      itemId: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      unit: inventoryItems.quantityUnit,
      itemStatus: inventoryItems.effectiveStatus,
      reasons: inventoryItems.statusReasons,
      locationName: locations.name,
      isTracked: checkoutItems.isTracked,
      quantity: checkoutItems.quantity,
      status: checkoutItems.status,
      returnedUnused: checkoutItems.returnedUnused,
      consumed: checkoutItems.consumed,
      lost: checkoutItems.lost,
      returnNote: checkoutItems.returnNote,
      returnedAt: checkoutItems.returnedAt,
    })
    .from(checkoutItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, checkoutItems.inventoryItemId))
    .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
    .where(eq(checkoutItems.checkoutId, id))
    .orderBy(asc(checkoutItems.createdAt), asc(inventoryItems.code));

  let reservation: { id: string; code: string; eventName: string } | null = null;
  if (row.reservationId) {
    const [r] = await tx
      .select({ id: reservations.id, code: reservations.code, eventName: reservations.eventName })
      .from(reservations)
      .where(eq(reservations.id, row.reservationId));
    reservation = r ?? null;
  }
  return {
    checkout: row,
    locationName: meta?.locationName ?? null,
    userName: meta?.userName ?? null,
    createdByName: creator?.name ?? null,
    lines,
    reservation,
  };
}

export type CheckoutDetail = Awaited<ReturnType<typeof getCheckoutDetail>>;

export async function listCheckouts(
  tx: Tx,
  ctx: Ctx,
  f: { status?: "active" | "draft" | "returned" | "overdue" | "all"; q?: string; page?: number; pageSize?: number },
) {
  const pageSize = Math.min(f.pageSize ?? 20, 100);
  const page = Math.max(f.page ?? 1, 1);
  const where: SQL[] = [eq(checkouts.organizationId, ctx.orgId), ne(checkouts.status, "cancelled")];
  const vis = visibilityFilter(ctx);
  if (vis) where.push(vis);
  if (f.status === "active") where.push(inArray(checkouts.status, ["active", "partially_returned"]));
  else if (f.status === "draft") where.push(eq(checkouts.status, "draft"));
  else if (f.status === "returned") where.push(eq(checkouts.status, "returned"));
  else if (f.status === "overdue")
    where.push(inArray(checkouts.status, ["active", "partially_returned"]), sql`${checkouts.dueAt} < now()`);
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(${checkouts.code} ilike ${like} or ${checkouts.eventName} ilike ${like})`);
  }
  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(checkouts).where(and(...where));
  const rows = await tx
    .select({
      id: checkouts.id,
      code: checkouts.code,
      eventName: checkouts.eventName,
      status: checkouts.status,
      currentStep: checkouts.currentStep,
      startedAt: checkouts.startedAt,
      dueAt: checkouts.dueAt,
      createdAt: checkouts.createdAt,
      updatedAt: checkouts.updatedAt,
      completedAt: checkouts.completedAt,
      locationName: locations.name,
      userName: users.name,
      itemsOut: sql<number>`(select count(*)::int from checkout_items ci where ci.checkout_id = ${checkouts.id} and ci.status = 'issued' and ci.parent_checkout_item_id is null)`,
      itemsTotal: sql<number>`(select count(*)::int from checkout_items ci where ci.checkout_id = ${checkouts.id} and ci.parent_checkout_item_id is null)`,
    })
    .from(checkouts)
    .leftJoin(locations, eq(locations.id, checkouts.locationId))
    .leftJoin(users, eq(users.id, checkouts.userId))
    .where(and(...where))
    .orderBy(desc(sql`coalesce(${checkouts.startedAt}, ${checkouts.updatedAt})`))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Candidate search for the basket (search/browse), flagged against this checkout's constraints. */
export async function searchCheckoutCandidates(
  tx: Tx,
  ctx: Ctx,
  checkoutId: string,
  f: { q?: string; kind?: InventoryKind | "all"; onlyEligible?: boolean },
) {
  const draft = await getCheckoutRow(tx, ctx, checkoutId);
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const where: SQL[] = [eq(inventoryItems.organizationId, ctx.orgId), isNull(inventoryItems.archivedAt)];
  if (f.kind && f.kind !== "all") where.push(eq(inventoryItems.kind, f.kind));
  if (like) where.push(sql`(${inventoryItems.code} ilike ${like} or ${inventoryItems.name} ilike ${like} or ${inventoryItems.techSpec} ilike ${like})`);
  where.push(sql`not exists (select 1 from assignments a where a.child_item_id = ${inventoryItems.id} and a.unassigned_at is null)`);
  const rows = await tx
    .select({
      id: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      kind: inventoryItems.kind,
      status: inventoryItems.effectiveStatus,
      unit: inventoryItems.quantityUnit,
      locationId: inventoryItems.locationId,
      locationName: locations.name,
      techSpec: inventoryItems.techSpec,
      children: sql<number>`(select count(*)::int from assignments a where a.parent_item_id = ${inventoryItems.id} and a.unassigned_at is null)`,
    })
    .from(inventoryItems)
    .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
    .where(and(...where))
    .orderBy(
      sql`case when ${inventoryItems.locationId} = ${draft.locationId} then 0 else 1 end`,
      sql`case when ${inventoryItems.effectiveStatus} = 'available' then 0 else 1 end`,
      asc(inventoryItems.code),
    )
    .limit(60);
  const { start, end } = checkoutWindow(draft, ctx);
  const verdicts = await evaluateCheckoutEligibility(tx, ctx.orgId, rows.map((r) => r.id), {
    locationId: draft.locationId,
    windowStart: start,
    windowEnd: end,
    reservationId: draft.reservationId,
    checkoutId,
  });
  const inBasket = await tx
    .select({ itemId: checkoutItems.inventoryItemId })
    .from(checkoutItems)
    .where(eq(checkoutItems.checkoutId, checkoutId));
  const basketSet = new Set(inBasket.map((b) => b.itemId));
  const out = rows.map((r) => {
    const v = verdicts.get(r.id)!;
    return {
      ...r,
      eligible: v.eligible,
      flags: v.flags,
      message: v.messages[0] ?? null,
      unallocated: v.unallocated ?? null,
      inBasket: basketSet.has(r.id),
    };
  });
  return f.onlyEligible ? out.filter((o) => o.eligible) : out;
}

/** Finds the active checkout that holds an item (used by check-in scanning). */
export async function findActiveCheckoutForItem(tx: Tx, ctx: Ctx, itemId: string) {
  const [row] = await tx
    .select({ checkoutId: checkoutItems.checkoutId, lineId: checkoutItems.id, parentId: checkoutItems.parentCheckoutItemId })
    .from(checkoutItems)
    .innerJoin(checkouts, eq(checkouts.id, checkoutItems.checkoutId))
    .where(
      and(
        eq(checkoutItems.organizationId, ctx.orgId),
        eq(checkoutItems.inventoryItemId, itemId),
        eq(checkoutItems.status, "issued"),
        inArray(checkouts.status, ["active", "partially_returned"]),
        visibilityFilter(ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}
