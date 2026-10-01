import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { allocateConsumable, assignChild } from "@/server/inventory";
import { addToBasket, confirmCheckout, createDraftCheckout, processReturn, updateDraftDetails } from "@/server/checkout";
import { createReservation, cancelReservation } from "@/server/reservations";
import { lockStock } from "@/server/consumables";
import { createTenant, inTenant, isoDaysFromNow, makeItem, pool, reload, type TestCtx } from "../helpers";

afterAll(() => pool.end());

async function draft(t: TestCtx, who = t.admin, location = t.locations.main, reservationId?: string) {
  return inTenant(t, async (tx) => {
    const d = await createDraftCheckout(tx, who, { reservationId });
    if (!reservationId) {
      await updateDraftDetails(tx, who, d.id, { step: 1, eventName: "Course" });
      await updateDraftDetails(tx, who, d.id, { step: 2, userId: who.user.id });
      await updateDraftDetails(tx, who, d.id, { step: 3, locationId: location });
    }
    return d;
  });
}

const lines = (t: TestCtx, checkoutId: string) =>
  inTenant(t, (tx) => tx.select().from(schema.checkoutItems).where(eq(schema.checkoutItems.checkoutId, checkoutId)));

describe("checkout engine", () => {
  it("blocks overdue inspection with a human-readable reason", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component", annualInspectionRequired: true, lastInspectionDate: isoDaysFromNow(-400) });
    const d = await draft(t);
    await expect(inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { itemId: item.id }))).rejects.toThrow(
      `${item.code} cannot be checked out because its annual inspection is overdue.`,
    );
  });

  it("blocks missing expiry information, other locations and assigned children", async () => {
    const t = await createTenant();
    const noExpiry = await makeItem(t, { kind: "component", lifespanMode: "finite", lifespanMonths: 60, expiryBasis: "first_use_date" });
    const yard = await makeItem(t, { kind: "component", locationId: t.locations.yard });
    const cfg = await makeItem(t, { kind: "configuration" });
    const child = await makeItem(t, { kind: "component" });
    await inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, child.id));
    const d = await draft(t);
    await expect(inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { itemId: noExpiry.id }))).rejects.toThrow(/expiry information is missing/);
    await expect(inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { itemId: yard.id }))).rejects.toThrow(/different location/);
    await expect(inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { itemId: child.id }))).rejects.toThrow(new RegExp(`Check out ${cfg.code} instead`));
  });

  it("repeated scans do not duplicate basket lines", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    const d = await draft(t);
    const first = await inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { scan: item.code }));
    const second = await inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { scan: item.code }));
    expect(first.added).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(await lines(t, d.id)).toHaveLength(1);
  });

  it("assembly checkout includes every tracked descendant exactly once plus allocated consumables", async () => {
    const t = await createTenant();
    const kit = await makeItem(t, { kind: "kit" });
    const cfg = await makeItem(t, { kind: "configuration" });
    const c1 = await makeItem(t, { kind: "component" });
    const c2 = await makeItem(t, { kind: "component" });
    const fuel = await makeItem(t, { kind: "consumable", quantityUnit: "litres", initialQuantity: 10 });
    await inTenant(t, async (tx) => {
      await assignChild(tx, t.admin, cfg.id, c1.id);
      await assignChild(tx, t.admin, kit.id, cfg.id);
      await assignChild(tx, t.admin, kit.id, c2.id);
      await allocateConsumable(tx, t.admin, cfg.id, fuel.id, 3);
    });
    const d = await draft(t);
    await inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { itemId: kit.id }));
    await inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { itemId: fuel.id, quantity: 2 }));
    await inTenant(t, (tx) => confirmCheckout(tx, t.admin, d.id));
    const ls = await lines(t, d.id);
    const tracked = ls.filter((l) => l.isTracked).map((l) => l.inventoryItemId).sort();
    expect(tracked).toEqual([kit.id, cfg.id, c1.id, c2.id].sort());
    expect(new Set(tracked).size).toBe(tracked.length);
    expect(ls.filter((l) => !l.isTracked).map((l) => l.quantity).sort()).toEqual([2, 3]);
    expect(ls.every((l) => l.status === "issued")).toBe(true);
    const s = await inTenant(t, (tx) => lockStock(tx, t.org.id, fuel.id));
    expect(s).toMatchObject({ allocatedQuantity: 3, issuedQuantity: 2, unallocated: 5 });
    expect((await reload(t, c1.id)).firstUseDate).not.toBeNull();
  });

  it("prevents two users from checking out the same equipment simultaneously", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    const d1 = await draft(t, t.admin);
    const d2 = await draft(t, t.trainer);
    await inTenant(t, (tx) => addToBasket(tx, t.admin, d1.id, { itemId: item.id }));
    await inTenant(t, (tx) => addToBasket(tx, t.trainer, d2.id, { itemId: item.id }));
    const results = await Promise.allSettled([
      inTenant(t, (tx) => confirmCheckout(tx, t.admin, d1.id)),
      inTenant(t, (tx) => confirmCheckout(tx, t.trainer, d2.id)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const issued = await inTenant(t, (tx) =>
      tx.select().from(schema.checkoutItems).where(eq(schema.checkoutItems.inventoryItemId, item.id)),
    );
    expect(issued.filter((l) => l.status === "issued")).toHaveLength(1);
  });

  it("concurrent consumable checkouts can never over-issue stock", async () => {
    const t = await createTenant();
    const tape = await makeItem(t, { kind: "consumable", quantityUnit: "units", initialQuantity: 5 });
    const ds = await Promise.all([draft(t), draft(t), draft(t)]);
    for (const d of ds) await inTenant(t, (tx) => addToBasket(tx, t.admin, d.id, { itemId: tape.id, quantity: 2 }));
    const results = await Promise.allSettled(ds.map((d) => inTenant(t, (tx) => confirmCheckout(tx, t.admin, d.id))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const s = await inTenant(t, (tx) => lockStock(tx, t.org.id, tape.id));
    expect(s.issuedQuantity).toBe(4);
  });
});

describe("returns", () => {
  it("supports partial returns, missing/damaged outcomes and consumable accounting", async () => {
    const t = await createTenant();
    const a = await makeItem(t, { kind: "component" });
    const b = await makeItem(t, { kind: "component" });
    const fuel = await makeItem(t, { kind: "consumable", quantityUnit: "litres", initialQuantity: 10 });
    const d = await draft(t);
    await inTenant(t, async (tx) => {
      await addToBasket(tx, t.admin, d.id, { itemId: a.id });
      await addToBasket(tx, t.admin, d.id, { itemId: b.id });
      await addToBasket(tx, t.admin, d.id, { itemId: fuel.id, quantity: 4 });
      await confirmCheckout(tx, t.admin, d.id);
    });
    const ls = await lines(t, d.id);
    const la = ls.find((l) => l.inventoryItemId === a.id)!;
    const lf = ls.find((l) => l.inventoryItemId === fuel.id)!;
    await expect(
      inTenant(t, (tx) => processReturn(tx, t.admin, d.id, [{ checkoutItemId: lf.id, outcome: "returned", unused: 1, consumed: 1, lost: 0 }])),
    ).rejects.toThrow(/add up/);
    const r1 = await inTenant(t, (tx) =>
      processReturn(tx, t.admin, d.id, [
        { checkoutItemId: la.id, outcome: "damaged", note: "cracked" },
        { checkoutItemId: lf.id, outcome: "returned", unused: 1, consumed: 2.5, lost: 0.5 },
      ]),
    );
    expect(r1).toMatchObject({ done: false, remaining: 1 });
    expect((await reload(t, a.id)).status).toBe("needs_inspection");
    const s = await inTenant(t, (tx) => lockStock(tx, t.org.id, fuel.id));
    expect(s).toMatchObject({ totalQuantity: 7, issuedQuantity: 0, unallocated: 7 });
    const lb = ls.find((l) => l.inventoryItemId === b.id)!;
    const r2 = await inTenant(t, (tx) => processReturn(tx, t.admin, d.id, [{ checkoutItemId: lb.id, outcome: "missing", note: "left on site" }]));
    expect(r2.done).toBe(true);
    expect((await reload(t, b.id)).effectiveStatus).toBe("missing");
    const [c] = await inTenant(t, (tx) => tx.select().from(schema.checkouts).where(eq(schema.checkouts.id, d.id)));
    expect(c.status).toBe("returned");
  });

  it("assembly contents must be accounted for with their parent; consumed allocation creates a shortage", async () => {
    const t = await createTenant();
    const cfg = await makeItem(t, { kind: "configuration" });
    const c1 = await makeItem(t, { kind: "component" });
    const oil = await makeItem(t, { kind: "consumable", quantityUnit: "litres", initialQuantity: 5 });
    await inTenant(t, async (tx) => {
      await assignChild(tx, t.admin, cfg.id, c1.id);
      await allocateConsumable(tx, t.admin, cfg.id, oil.id, 2);
    });
    const d = await draft(t);
    await inTenant(t, async (tx) => {
      await addToBasket(tx, t.admin, d.id, { itemId: cfg.id });
      await confirmCheckout(tx, t.admin, d.id);
    });
    const ls = await lines(t, d.id);
    const root = ls.find((l) => l.inventoryItemId === cfg.id)!;
    const child = ls.find((l) => l.inventoryItemId === c1.id)!;
    const oilLine = ls.find((l) => l.inventoryItemId === oil.id)!;
    await expect(inTenant(t, (tx) => processReturn(tx, t.admin, d.id, [{ checkoutItemId: root.id, outcome: "returned" }]))).rejects.toThrow(/Record an outcome/);
    await expect(inTenant(t, (tx) => processReturn(tx, t.admin, d.id, [{ checkoutItemId: child.id, outcome: "returned" }]))).rejects.toThrow(/Check in/);
    await inTenant(t, (tx) =>
      processReturn(tx, t.admin, d.id, [
        { checkoutItemId: root.id, outcome: "returned" },
        { checkoutItemId: child.id, outcome: "returned" },
        { checkoutItemId: oilLine.id, outcome: "returned", unused: 1, consumed: 1, lost: 0 },
      ]),
    );
    const c = await reload(t, cfg.id);
    expect(c.effectiveStatus).toBe("needs_inspection");
    expect(c.statusReasons.map((r) => r.code)).toContain("consumable_shortage");
    expect(await inTenant(t, (tx) => lockStock(tx, t.org.id, oil.id))).toMatchObject({ totalQuantity: 4, allocatedQuantity: 1 });
  });
});

describe("reservations", () => {
  const at = (days: number, hours: number) => new Date(Date.now() + days * 86400_000 + hours * 3600_000).toISOString();

  it("prevents double booking but allows non-overlapping windows", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    await inTenant(t, (tx) =>
      createReservation(tx, t.admin, { eventName: "A", startsAt: at(2, 0), endsAt: at(2, 4), locationId: t.locations.main, items: [{ itemId: item.id }] }),
    );
    await expect(
      inTenant(t, (tx) =>
        createReservation(tx, t.admin, { eventName: "B", startsAt: at(2, 2), endsAt: at(2, 6), locationId: t.locations.main, items: [{ itemId: item.id }] }),
      ),
    ).rejects.toThrow(/Reserved for A/);
    await inTenant(t, (tx) =>
      createReservation(tx, t.admin, { eventName: "C", startsAt: at(2, 4), endsAt: at(2, 8), locationId: t.locations.main, items: [{ itemId: item.id }] }),
    );
  });

  it("concurrent reservations for the same window: only one succeeds", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    const results = await Promise.allSettled(
      ["X", "Y", "Z"].map((n) =>
        inTenant(t, (tx) =>
          createReservation(tx, t.admin, { eventName: n, startsAt: at(3, 0), endsAt: at(3, 3), locationId: t.locations.main, items: [{ itemId: item.id }] }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("reserved equipment cannot be checked out by another session unless explicitly overridden", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    const r = await inTenant(t, (tx) =>
      createReservation(tx, t.admin, { eventName: "Gala", startsAt: at(0, 1), endsAt: at(0, 6), locationId: t.locations.main, items: [{ itemId: item.id }] }),
    );
    const d = await draft(t, t.trainer);
    await expect(inTenant(t, (tx) => addToBasket(tx, t.trainer, d.id, { itemId: item.id }))).rejects.toThrow(/reserved for Gala/);
    // Admin override (org setting enabled) requires an explicit flag and a reason at confirmation.
    const d2 = await draft(t, t.admin);
    await inTenant(t, (tx) => addToBasket(tx, t.admin, d2.id, { itemId: item.id, override: true }));
    await expect(inTenant(t, (tx) => confirmCheckout(tx, t.admin, d2.id))).rejects.toThrow(/reserved/);
    await inTenant(t, (tx) => confirmCheckout(tx, t.admin, d2.id, { overrideReason: "Swap agreed with event lead" }));
    void r;
  });

  it("checking out from the reservation fulfils it", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    const r = await inTenant(t, (tx) =>
      createReservation(tx, t.admin, { eventName: "Course", startsAt: at(0, 1), endsAt: at(0, 5), locationId: t.locations.main, items: [{ itemId: item.id }] }),
    );
    const d = await draft(t, t.admin, t.locations.main, r.id);
    await inTenant(t, (tx) => confirmCheckout(tx, t.admin, d.id));
    const [res] = await inTenant(t, (tx) => tx.select().from(schema.reservations).where(eq(schema.reservations.id, r.id)));
    expect(res.status).toBe("fulfilled");
  });

  it("cancelling frees the window", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    const r = await inTenant(t, (tx) =>
      createReservation(tx, t.admin, { eventName: "One", startsAt: at(4, 0), endsAt: at(4, 2), locationId: t.locations.main, items: [{ itemId: item.id }] }),
    );
    await inTenant(t, (tx) => cancelReservation(tx, t.admin, r.id, "event moved"));
    await inTenant(t, (tx) =>
      createReservation(tx, t.admin, { eventName: "Two", startsAt: at(4, 0), endsAt: at(4, 2), locationId: t.locations.main, items: [{ itemId: item.id }] }),
    );
  });

  it("trainers only see and manage their own checkouts", async () => {
    const t = await createTenant();
    const d = await draft(t, t.admin);
    await expect(inTenant(t, (tx) => addToBasket(tx, t.trainer, d.id, { scan: "CPT-000001" }))).rejects.toThrow(/could not be found/);
  });
});
