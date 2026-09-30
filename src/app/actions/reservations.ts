"use server";

import { withTenant } from "@/db";
import { actionContext } from "@/server/auth/context";
import { AppError, runAction } from "@/server/errors";
import { eq } from "drizzle-orm";
import { locations } from "@/db/schema";
import { getItemOrThrow } from "@/server/inventory";
import {
  cancelReservation,
  createReservation,
  evaluateReservationAvailability,
  searchReservationCandidates,
  type ReservationInput,
} from "@/server/reservations";
import { resolveScan } from "@/server/qr";
import type { InventoryKind } from "@/lib/domain";

export async function reservationCandidatesAction(input: { q: string; kind: InventoryKind | "all"; startsAt: string; endsAt: string; locationId: string }) {
  return runAction(async () => {
    const ctx = await actionContext("reservation.create");
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new AppError("Invalid time", "Choose a valid start and end time.", "validation");
    }
    return withTenant(ctx.orgId, (tx) => searchReservationCandidates(tx, ctx, { ...input, startsAt, endsAt }));
  });
}

export async function reservationScanAction(scan: string, input: { startsAt: string; endsAt: string; locationId: string }) {
  return runAction(async () => {
    const ctx = await actionContext("reservation.create");
    return withTenant(ctx.orgId, async (tx) => {
      const id = await resolveScan(tx, ctx.orgId, scan);
      if (!id) throw new AppError("Code not recognised", "This QR code does not match any equipment in your organization.", "not_found");
      const item = await getItemOrThrow(tx, ctx.orgId, id);
      const [loc] = await tx.select({ name: locations.name }).from(locations).where(eq(locations.id, item.locationId!));
      const avail = await evaluateReservationAvailability(tx, ctx.orgId, [id], {
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        locationId: input.locationId,
      });
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        kind: item.kind,
        status: item.effectiveStatus,
        unit: item.quantityUnit,
        locationName: loc?.name ?? null,
        ...avail.get(id)!,
      };
    });
  });
}

export async function createReservationAction(input: ReservationInput) {
  return runAction(async () => {
    const ctx = await actionContext("reservation.create");
    const r = await withTenant(ctx.orgId, (tx) => createReservation(tx, ctx, input));
    return { id: r.id, code: r.code };
  });
}

export async function cancelReservationAction(id: string, reason: string | null) {
  return runAction(async () => {
    const ctx = await actionContext("reservation.create");
    await withTenant(ctx.orgId, (tx) => cancelReservation(tx, ctx, id, reason));
  });
}
