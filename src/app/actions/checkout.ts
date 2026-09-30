"use server";

import { redirect } from "next/navigation";
import { withTenant } from "@/db";
import { actionContext } from "@/server/auth/context";
import { AppError, runAction } from "@/server/errors";
import {
  addToBasket,
  cancelDraft,
  confirmCheckout,
  createDraftCheckout,
  findActiveCheckoutForItem,
  processReturn,
  removeFromBasket,
  searchCheckoutCandidates,
  updateBasketQuantity,
  updateDraftDetails,
  type ReturnLineInput,
} from "@/server/checkout";
import { resolveScan } from "@/server/qr";
import type { InventoryKind } from "@/lib/domain";

/** Step 1: creates the draft (persisted immediately so it can be resumed later). */
export async function startCheckoutAction(input: { eventName: string; dueAt?: string | null; notes?: string | null; itemId?: string | null }) {
  const result = await runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, async (tx) => {
      const draft = await createDraftCheckout(tx, ctx);
      await updateDraftDetails(tx, ctx, draft.id, { step: 1, eventName: input.eventName, dueAt: input.dueAt, notes: input.notes });
      return { id: draft.id, pendingItem: input.itemId ?? null };
    });
  });
  if (result.ok) {
    redirect(`/checkouts/${result.data.id}/edit?step=2${result.data.pendingItem ? `&item=${result.data.pendingItem}` : ""}`);
  }
  return result;
}

export async function startFromReservationAction(reservationId: string) {
  const result = await runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, (tx) => createDraftCheckout(tx, ctx, { reservationId }));
  });
  if (result.ok) redirect(`/checkouts/${result.data.id}/edit?step=4`);
  return result;
}

export async function updateCheckoutStepAction(
  id: string,
  input: { step: 1 | 2 | 3; eventName?: string; dueAt?: string | null; notes?: string | null; userId?: string; locationId?: string },
) {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, (tx) => updateDraftDetails(tx, ctx, id, input));
  });
}

export async function addToBasketAction(id: string, input: { itemId?: string; scan?: string; quantity?: number; override?: boolean }) {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, (tx) => addToBasket(tx, ctx, id, input));
  });
}

export async function removeFromBasketAction(id: string, lineId: string) {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    await withTenant(ctx.orgId, (tx) => removeFromBasket(tx, ctx, id, lineId));
  });
}

export async function updateBasketQuantityAction(id: string, lineId: string, quantity: number) {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    await withTenant(ctx.orgId, (tx) => updateBasketQuantity(tx, ctx, id, lineId, Number(quantity)));
  });
}

export async function searchCandidatesAction(id: string, q: string, kind: InventoryKind | "all") {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, (tx) => searchCheckoutCandidates(tx, ctx, id, { q, kind }));
  });
}

export async function confirmCheckoutAction(id: string, overrideReason?: string | null) {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, (tx) => confirmCheckout(tx, ctx, id, { overrideReason }));
  });
}

export async function cancelDraftAction(id: string) {
  const result = await runAction(async () => {
    const ctx = await actionContext("checkout.create");
    await withTenant(ctx.orgId, (tx) => cancelDraft(tx, ctx, id));
  });
  if (result.ok) redirect("/dashboard");
  return result;
}

export async function processReturnAction(id: string, lines: ReturnLineInput[]) {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, (tx) => processReturn(tx, ctx, id, lines));
  });
}

/** Check-in by scan: finds the active checkout holding the scanned item. */
export async function findCheckoutByScanAction(scan: string) {
  return runAction(async () => {
    const ctx = await actionContext("checkout.create");
    return withTenant(ctx.orgId, async (tx) => {
      const itemId = await resolveScan(tx, ctx.orgId, scan);
      if (!itemId) throw new AppError("Code not recognised", "This QR code does not match any equipment in your organization.", "not_found");
      const found = await findActiveCheckoutForItem(tx, ctx, itemId);
      if (!found) throw new AppError("Not checked out", "This equipment is not part of an active checkout you can check in.", "not_found");
      return { checkoutId: found.checkoutId, lineId: found.lineId, itemId };
    });
  });
}
