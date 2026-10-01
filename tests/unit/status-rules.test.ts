import { describe, expect, it } from "vitest";
import { computeExpiry, computeStatuses, wouldCreateCycle, type StatusInputItem } from "@/lib/status-rules";

const base = (over: Partial<StatusInputItem> & { id: string }): StatusInputItem => ({
  code: over.id.toUpperCase(),
  name: over.id,
  kind: "component",
  status: "available",
  lifespanMode: "unlimited",
  lifespanMonths: null,
  expiryBasis: null,
  manufactureDate: null,
  firstUseDate: null,
  explicitExpiry: null,
  annualInspectionRequired: false,
  nextInspectionDate: null,
  ...over,
});

describe("lifespan & expiry", () => {
  it("finite lifespan from manufacture date", () => {
    expect(computeExpiry({ lifespanMode: "finite", lifespanMonths: 120, expiryBasis: "manufacture_date", manufactureDate: "2020-01-15", firstUseDate: null, explicitExpiry: null })).toEqual({
      expiry: "2030-01-15",
      missingInfo: false,
      pendingInspection: false,
    });
  });
  it("finite lifespan from first use date", () => {
    expect(computeExpiry({ lifespanMode: "finite", lifespanMonths: 12, expiryBasis: "first_use_date", manufactureDate: "2019-01-01", firstUseDate: "2024-02-29", explicitExpiry: null }).expiry).toBe("2025-02-28");
  });
  it("earlier applicable expiry wins", () => {
    expect(computeExpiry({ lifespanMode: "finite", lifespanMonths: 120, expiryBasis: "manufacture_date", manufactureDate: "2020-01-01", firstUseDate: null, explicitExpiry: "2026-06-01" }).expiry).toBe("2026-06-01");
  });
  it("missing expiry information is flagged", () => {
    expect(computeExpiry({ lifespanMode: "finite", lifespanMonths: 120, expiryBasis: "first_use_date", manufactureDate: "2020-01-01", firstUseDate: null, explicitExpiry: null }).missingInfo).toBe(true);
    expect(computeExpiry({ lifespanMode: "explicit", lifespanMonths: null, expiryBasis: null, manufactureDate: null, firstUseDate: null, explicitExpiry: null }).missingInfo).toBe(true);
  });
  it("unlimited lifespan is pending inspection with no expiry", () => {
    expect(computeExpiry({ lifespanMode: "unlimited", lifespanMonths: null, expiryBasis: null, manufactureDate: null, firstUseDate: null, explicitExpiry: null })).toEqual({
      expiry: null,
      missingInfo: false,
      pendingInspection: true,
    });
  });
});

describe("status computation & propagation", () => {
  const today = "2026-09-30";

  it("expired and overdue items need inspection; missing info only blocks checkout", () => {
    const items = [
      base({ id: "a", lifespanMode: "explicit", explicitExpiry: "2026-09-30" }),
      base({ id: "b", annualInspectionRequired: true, nextInspectionDate: "2026-09-29" }),
      base({ id: "c", lifespanMode: "explicit" }),
    ];
    const r = computeStatuses(items, new Map(), [], today);
    expect(r.get("a")!.effectiveStatus).toBe("needs_inspection");
    expect(r.get("b")!.reasons[0].code).toBe("inspection_overdue");
    expect(r.get("c")!.effectiveStatus).toBe("available");
    expect(r.get("c")!.checkoutBlocked).toBe(true);
  });

  it("propagates Component -> Configuration -> Kit and lists all contributing reasons", () => {
    const items = [
      base({ id: "kit", kind: "kit" }),
      base({ id: "cfg", kind: "configuration" }),
      base({ id: "c1", lifespanMode: "explicit", explicitExpiry: "2026-01-01" }),
      base({ id: "c2", annualInspectionRequired: true, nextInspectionDate: "2026-09-01" }),
      base({ id: "fuel", kind: "consumable" }),
    ];
    const children = new Map([
      ["kit", ["cfg"]],
      ["cfg", ["c1", "c2"]],
    ]);
    const r = computeStatuses(items, children, [{ parentId: "kit", consumableId: "fuel", required: 3, allocated: 1 }], today);
    const kit = r.get("kit")!;
    expect(kit.effectiveStatus).toBe("needs_inspection");
    expect(kit.reasons.map((x) => x.code).sort()).toEqual(["child", "child", "consumable_shortage"]);
    expect(kit.reasons.find((x) => x.sourceCode === "C1")?.path).toEqual(["CFG", "C1"]);
    expect(r.get("cfg")!.effectiveStatus).toBe("needs_inspection");
  });

  it("uses priority Rejected > Missing > Needs Inspection", () => {
    const items = [
      base({ id: "p", kind: "kit" }),
      base({ id: "x", status: "needs_inspection" }),
      base({ id: "y", status: "missing" }),
      base({ id: "z", status: "rejected" }),
    ];
    const r1 = computeStatuses(items, new Map([["p", ["x", "y"]]]), [], today);
    expect(r1.get("p")!.effectiveStatus).toBe("missing");
    const r2 = computeStatuses(items, new Map([["p", ["x", "y", "z"]]]), [], today);
    expect(r2.get("p")!.effectiveStatus).toBe("rejected");
  });

  it("a parent is never Available while a restricted child remains", () => {
    const items = [base({ id: "p", kind: "configuration", status: "available" }), base({ id: "c", status: "needs_inspection" })];
    expect(computeStatuses(items, new Map([["p", ["c"]]]), [], today).get("p")!.effectiveStatus).not.toBe("available");
  });

  it("is safe against accidental cycles", () => {
    const items = [base({ id: "a", kind: "kit" }), base({ id: "b", kind: "kit" })];
    const r = computeStatuses(items, new Map([["a", ["b"]], ["b", ["a"]]]), [], today);
    expect(r.size).toBe(2);
  });
});

describe("cycle detection", () => {
  it("detects self reference and ancestry loops", () => {
    const parentOf = new Map([
      ["cfg", "kitB"],
      ["kitB", "kitA"],
    ]);
    expect(wouldCreateCycle("x", "x", parentOf)).toBe(true);
    expect(wouldCreateCycle("cfg", "kitA", parentOf)).toBe(true);
    expect(wouldCreateCycle("kitA", "other", parentOf)).toBe(false);
  });
});
