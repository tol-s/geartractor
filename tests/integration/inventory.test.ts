import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  allocateConsumable,
  archiveInventoryItem,
  assignChild,
  listAssignmentCandidates,
  listInventory,
  releaseAllocation,
  setItemStatus,
  unassignChild,
  updateInventoryItem,
} from "@/server/inventory";
import { lockStock, manualStockChange } from "@/server/consumables";
import { recordInspection } from "@/server/inspections";
import { AppError } from "@/server/errors";
import { createTenant, inTenant, isoDaysFromNow, makeItem, pool, reload } from "../helpers";

afterAll(() => pool.end());

describe("inventory CRUD", () => {
  it("creates items with per-tenant sequential codes, QR tokens and audit", async () => {
    const t = await createTenant();
    const a = await makeItem(t, { kind: "component", name: "Rope 1", tags: ["Rope", "PPE"] });
    const b = await makeItem(t, { kind: "component", name: "Rope 2" });
    expect(a.code).toBe("CPT-000001");
    expect(b.code).toBe("CPT-000002");
    const kit = await makeItem(t, { kind: "kit" });
    expect(kit.code).toBe("KIT-000001");
    const qr = await inTenant(t, (tx) => tx.select().from(schema.qrCodes).where(eq(schema.qrCodes.inventoryItemId, a.id)));
    expect(qr[0].token.length).toBeGreaterThanOrEqual(12);
    const list = await inTenant(t, (tx) => listInventory(tx, t.org.id, { q: "rope", tag: "PPE" }));
    expect(list.rows.map((r) => r.code)).toEqual(["CPT-000001"]);
    const audit = await inTenant(t, (tx) => tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, a.id)));
    expect(audit.map((x) => x.action)).toContain("create");
  });

  it("requires a reason for status changes and records status history", async () => {
    const t = await createTenant();
    const a = await makeItem(t, { kind: "component" });
    await expect(
      inTenant(t, (tx) => updateInventoryItem(tx, t.admin, a.id, { kind: "component", name: a.name, locationId: t.locations.main, status: "missing" })),
    ).rejects.toBeInstanceOf(AppError);
    await inTenant(t, (tx) => setItemStatus(tx, t.admin, a.id, "missing", "Lost on course"));
    const hist = await inTenant(t, (tx) => tx.select().from(schema.statusHistory).where(eq(schema.statusHistory.inventoryItemId, a.id)));
    expect(hist.some((h) => h.newStatus === "missing" && h.reason === "Lost on course")).toBe(true);
  });

  it("archives only unused, unassigned items", async () => {
    const t = await createTenant();
    const cfg = await makeItem(t, { kind: "configuration" });
    const c = await makeItem(t, { kind: "component" });
    await inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, c.id));
    await expect(inTenant(t, (tx) => archiveInventoryItem(tx, t.admin, c.id, "retire"))).rejects.toThrow(/Remove/);
    await inTenant(t, (tx) => unassignChild(tx, t.admin, cfg.id, c.id));
    await inTenant(t, (tx) => archiveInventoryItem(tx, t.admin, c.id, "retire"));
    expect((await reload(t, c.id)).archivedAt).not.toBeNull();
  });
});

describe("assignments (Components, Configurations, Kits)", () => {
  it("a component can only have one immediate parent", async () => {
    const t = await createTenant();
    const c1 = await makeItem(t, { kind: "configuration" });
    const c2 = await makeItem(t, { kind: "configuration" });
    const comp = await makeItem(t, { kind: "component" });
    await inTenant(t, (tx) => assignChild(tx, t.admin, c1.id, comp.id));
    await expect(inTenant(t, (tx) => assignChild(tx, t.admin, c2.id, comp.id))).rejects.toThrow(/Already assigned/);
  });

  it("enforces type rules, location, status and self-reference", async () => {
    const t = await createTenant();
    const cfg = await makeItem(t, { kind: "configuration" });
    const kit = await makeItem(t, { kind: "kit" });
    const elsewhere = await makeItem(t, { kind: "component", locationId: t.locations.yard });
    const flagged = await makeItem(t, { kind: "component", status: "needs_inspection", statusReason: "worn" });
    await expect(inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, kit.id))).rejects.toThrow(/cannot contain Kits/);
    await expect(inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, elsewhere.id))).rejects.toThrow(/Different storage location/);
    await expect(inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, flagged.id))).rejects.toThrow(/Needs Inspection/);
    await expect(inTenant(t, (tx) => assignChild(tx, t.admin, kit.id, kit.id))).rejects.toThrow(/itself/);
  });

  it("prevents circular kit nesting", async () => {
    const t = await createTenant();
    const a = await makeItem(t, { kind: "kit", name: "Kit A" });
    const b = await makeItem(t, { kind: "kit", name: "Kit B" });
    const c = await makeItem(t, { kind: "kit", name: "Kit C" });
    await inTenant(t, (tx) => assignChild(tx, t.admin, a.id, b.id));
    await inTenant(t, (tx) => assignChild(tx, t.admin, b.id, c.id));
    await expect(inTenant(t, (tx) => assignChild(tx, t.admin, c.id, a.id))).rejects.toThrow(/circular|Already assigned/i);
    const candidates = await inTenant(t, (tx) => listAssignmentCandidates(tx, t.org.id, c.id, ""));
    expect(candidates.find((x) => x.id === a.id)?.eligible).toBe(false);
  });

  it("moves descendants with their parent and blocks independent location changes", async () => {
    const t = await createTenant();
    const cfg = await makeItem(t, { kind: "configuration" });
    const comp = await makeItem(t, { kind: "component" });
    await inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, comp.id));
    await expect(
      inTenant(t, (tx) => updateInventoryItem(tx, t.admin, comp.id, { kind: "component", name: comp.name, locationId: t.locations.yard, status: "available" })),
    ).rejects.toThrow(/managed by the parent|Change the location of the parent/);
    await inTenant(t, (tx) => updateInventoryItem(tx, t.admin, cfg.id, { kind: "configuration", name: cfg.name, locationId: t.locations.yard, status: "available" }));
    expect((await reload(t, comp.id)).locationId).toBe(t.locations.yard);
  });
});

describe("consumables & allocation", () => {
  it("reserves stock immediately and prevents over / duplicate / negative allocation", async () => {
    const t = await createTenant();
    const fuel = await makeItem(t, { kind: "consumable", quantityUnit: "litres", initialQuantity: 10 });
    const cfg = await makeItem(t, { kind: "configuration" });
    const cfg2 = await makeItem(t, { kind: "configuration" });
    await inTenant(t, (tx) => allocateConsumable(tx, t.admin, cfg.id, fuel.id, 6));
    const s1 = await inTenant(t, (tx) => lockStock(tx, t.org.id, fuel.id));
    expect(s1).toMatchObject({ totalQuantity: 10, allocatedQuantity: 6, unallocated: 4 });
    await expect(inTenant(t, (tx) => allocateConsumable(tx, t.admin, cfg2.id, fuel.id, 5))).rejects.toThrow(/unallocated/);
    await expect(inTenant(t, (tx) => allocateConsumable(tx, t.admin, cfg.id, fuel.id, 1))).rejects.toThrow(/already allocated/);
    await expect(inTenant(t, (tx) => allocateConsumable(tx, t.admin, cfg2.id, fuel.id, -1))).rejects.toThrow(/greater than zero/);
    await expect(inTenant(t, (tx) => manualStockChange(tx, t.admin, fuel.id, { type: "adjustment", quantity: -5, reason: "stocktake" }))).rejects.toThrow(/cannot drop/);
  });

  it("nested configuration inside a kit does not double reserve stock", async () => {
    const t = await createTenant();
    const tape = await makeItem(t, { kind: "consumable", quantityUnit: "units", initialQuantity: 5 });
    const cfg = await makeItem(t, { kind: "configuration" });
    const kit = await makeItem(t, { kind: "kit" });
    await inTenant(t, (tx) => allocateConsumable(tx, t.admin, cfg.id, tape.id, 2));
    await inTenant(t, (tx) => assignChild(tx, t.admin, kit.id, cfg.id));
    const s = await inTenant(t, (tx) => lockStock(tx, t.org.id, tape.id));
    expect(s.allocatedQuantity).toBe(2);
    await inTenant(t, async (tx) => {
      const [a] = await tx
        .select()
        .from(schema.consumableAllocations)
        .where(and(eq(schema.consumableAllocations.parentItemId, cfg.id), isNull(schema.consumableAllocations.releasedAt)));
      await releaseAllocation(tx, t.admin, a.id);
    });
    expect((await inTenant(t, (tx) => lockStock(tx, t.org.id, tape.id))).allocatedQuantity).toBe(0);
  });

  it("does not convert units", async () => {
    const t = await createTenant();
    const cord = await makeItem(t, { kind: "consumable", quantityUnit: "metres", initialQuantity: 100 });
    expect((await reload(t, cord.id)).quantityUnit).toBe("metres");
  });
});

describe("status propagation & inspections", () => {
  it("propagates Component -> Configuration -> Kit and clears after passing inspection", async () => {
    const t = await createTenant();
    const kit = await makeItem(t, { kind: "kit" });
    const cfg = await makeItem(t, { kind: "configuration" });
    const comp = await makeItem(t, { kind: "component", annualInspectionRequired: true, lastInspectionDate: isoDaysFromNow(-10) });
    await inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, comp.id));
    await inTenant(t, (tx) => assignChild(tx, t.admin, kit.id, cfg.id));
    await inTenant(t, (tx) => setItemStatus(tx, t.admin, comp.id, "needs_inspection", "Frayed"));
    expect((await reload(t, cfg.id)).effectiveStatus).toBe("needs_inspection");
    const k = await reload(t, kit.id);
    expect(k.effectiveStatus).toBe("needs_inspection");
    expect(k.statusReasons[0].path).toEqual([cfg.code, comp.code]);

    const today = isoDaysFromNow(0);
    await inTenant(t, (tx) => recordInspection(tx, t.admin, { rootItemId: kit.id, inspectedOn: today, records: [{ itemId: comp.id, outcome: "pass" }] }));
    const c = await reload(t, comp.id);
    expect(c.status).toBe("available");
    expect(c.nextInspectionDate! > today).toBe(true);
    expect((await reload(t, kit.id)).effectiveStatus).toBe("available");
  });

  it("passing never overrides Missing, Rejected or hard expiry; exceptions need a note", async () => {
    const t = await createTenant();
    const missing = await makeItem(t, { kind: "component", status: "missing", statusReason: "lost" });
    const expired = await makeItem(t, { kind: "component", lifespanMode: "explicit", explicitExpiry: isoDaysFromNow(-1) });
    const today = isoDaysFromNow(0);
    await expect(
      inTenant(t, (tx) => recordInspection(tx, t.admin, { inspectedOn: today, records: [{ itemId: missing.id, outcome: "exception" }] })),
    ).rejects.toThrow(/Explain/);
    await inTenant(t, (tx) =>
      recordInspection(tx, t.admin, { inspectedOn: today, records: [{ itemId: missing.id, outcome: "pass" }, { itemId: expired.id, outcome: "pass" }] }),
    );
    expect((await reload(t, missing.id)).effectiveStatus).toBe("missing");
    const e = await reload(t, expired.id);
    expect(e.effectiveStatus).toBe("needs_inspection");
    expect(e.statusReasons.map((r) => r.code)).toContain("expired");
    const recs = await inTenant(t, (tx) => tx.select().from(schema.inspectionRecords));
    expect(recs).toHaveLength(2);
  });

  it("failing an inspection rejects the item and propagates Rejected", async () => {
    const t = await createTenant();
    const cfg = await makeItem(t, { kind: "configuration" });
    const comp = await makeItem(t, { kind: "component" });
    await inTenant(t, (tx) => assignChild(tx, t.admin, cfg.id, comp.id));
    await inTenant(t, (tx) => recordInspection(tx, t.admin, { inspectedOn: isoDaysFromNow(0), records: [{ itemId: comp.id, outcome: "fail", notes: "core shot" }] }));
    expect((await reload(t, cfg.id)).effectiveStatus).toBe("rejected");
  });
});
