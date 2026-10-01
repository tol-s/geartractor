import { describe, expect, it } from "vitest";
import { CSV_BOM, csvDate, csvEscape, csvLine } from "@/lib/csv";
import { permissionsFor } from "@/server/auth/permissions";
import { parseScanInput } from "@/server/qr";
import { validatePasswordStrength, verifyPassword, hashPassword } from "@/server/auth/password";
import { addMonthsIso, isoDateInZone } from "@/lib/utils";
import { blockedMessage } from "@/server/checkout";

describe("CSV", () => {
  it("escapes quotes, commas and newlines and guards formulas", () => {
    expect(csvEscape('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvEscape("-5")).toBe("-5");
    expect(csvEscape(-2.5)).toBe("-2.5");
    expect(csvEscape(["a", "b"])).toBe("a; b");
    expect(csvLine(["x", null, 3])).toBe("x,,3\r\n");
    expect(CSV_BOM).toBe("﻿");
  });
  it("formats dates as YYYY-MM-DD", () => {
    expect(csvDate(new Date("2026-03-04T15:00:00Z"))).toBe("2026-03-04");
    expect(csvDate("2026-03-04")).toBe("2026-03-04");
    expect(csvDate(null)).toBe("");
  });
});

describe("permissions", () => {
  it("trainers cannot manage; admins can; settings widen trainer inspection", () => {
    expect(permissionsFor("trainer").has("inventory.manage")).toBe(false);
    expect(permissionsFor("trainer").has("checkout.create")).toBe(true);
    expect(permissionsFor("trainer").has("inspection.perform")).toBe(false);
    expect(permissionsFor("trainer", { trainersCanInspect: true }).has("inspection.perform")).toBe(true);
    expect(permissionsFor("org_admin").has("users.manage")).toBe(true);
    expect(permissionsFor("org_admin").has("platform.manage")).toBe(false);
    expect(permissionsFor("super_admin").has("platform.manage")).toBe(true);
  });
});

describe("QR scan parsing", () => {
  it("accepts URLs, tokens and human IDs", () => {
    expect(parseScanInput("https://app.example.com/q/AbCdEf123456_-")).toEqual({ token: "AbCdEf123456_-" });
    expect(parseScanInput("cpt-000031")).toEqual({ code: "CPT-000031" });
    expect(parseScanInput("  ")).toEqual({});
  });
});

describe("passwords", () => {
  it("hashes and verifies; enforces strength", async () => {
    const h = await hashPassword("correct horse 42");
    expect(await verifyPassword("correct horse 42", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(validatePasswordStrength("short1")).not.toBeNull();
    expect(validatePasswordStrength("longpassword")).not.toBeNull();
    expect(validatePasswordStrength("longpassword1")).toBeNull();
  });
});

describe("dates", () => {
  it("adds months clamping to month end and respects time zones", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-09-30", 12)).toBe("2027-09-30");
    expect(isoDateInZone(new Date("2026-10-01T03:00:00Z"), "America/Edmonton")).toBe("2026-09-30");
  });
});

describe("blocked checkout messages", () => {
  it("explains the first reason in plain language", () => {
    expect(blockedMessage("CPT-000031", [{ code: "inspection_overdue", label: "Inspection overdue since 2026-01-01", severity: "needs_inspection" }])).toBe(
      "CPT-000031 cannot be checked out because its annual inspection is overdue.",
    );
  });
});
