import { z } from "zod";
import { EXPIRY_BASES, INVENTORY_KINDS, ITEM_STATUSES, LIFESPAN_MODES, QUANTITY_UNITS } from "./domain";

const trimmed = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const isoDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use the format YYYY-MM-DD");

const optionalInt = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min && v <= max), `Enter a whole number between ${min} and ${max}`);

const optionalQty = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e10), "Enter a valid quantity");

export const positiveQty = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v > 0 && v < 1e10, "Quantity must be greater than zero")
  .transform((v) => Math.round(v * 1000) / 1000);

export const inventoryInputSchema = z
  .object({
    kind: z.enum(INVENTORY_KINDS),
    name: z.string().trim().min(1, "Name is required").max(160),
    serialNumber: trimmed(120),
    techSpec: trimmed(200),
    manufacturer: trimmed(120),
    locationId: z.string().uuid("Select a storage location"),
    status: z.enum(ITEM_STATUSES).default("available"),
    statusReason: trimmed(500),
    manufactureDate: isoDate,
    firstUseDate: isoDate,
    lifespanMode: z.enum(LIFESPAN_MODES).default("unlimited"),
    lifespanMonths: optionalInt(1, 1200),
    expiryBasis: z.enum(EXPIRY_BASES).nullable().optional().transform((v) => v ?? null),
    explicitExpiry: isoDate,
    annualInspectionRequired: z.boolean().default(false),
    inspectionIntervalMonths: optionalInt(1, 120).transform((v) => v ?? 12),
    lastInspectionDate: isoDate,
    nextInspectionDate: isoDate,
    lastUseDate: isoDate,
    technicalDetails: trimmed(5000),
    notes: trimmed(2000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    quantityUnit: z.enum(QUANTITY_UNITS).nullable().optional().transform((v) => v ?? null),
    reorderThreshold: optionalQty,
    initialQuantity: optionalQty,
    purpose: trimmed(1000),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "consumable" && !v.quantityUnit) {
      ctx.addIssue({ code: "custom", path: ["quantityUnit"], message: "Select a quantity unit" });
    }
    if (v.lifespanMode === "finite") {
      if (!v.lifespanMonths)
        ctx.addIssue({ code: "custom", path: ["lifespanMonths"], message: "Life span is required for finite lifespan" });
      if (!v.expiryBasis)
        ctx.addIssue({ code: "custom", path: ["expiryBasis"], message: "Select an expiry basis" });
    }
    if (v.lifespanMode === "explicit" && !v.explicitExpiry) {
      ctx.addIssue({ code: "custom", path: ["explicitExpiry"], message: "Expiry date is required" });
    }
    if (v.manufactureDate && v.firstUseDate && v.firstUseDate < v.manufactureDate) {
      ctx.addIssue({ code: "custom", path: ["firstUseDate"], message: "First use cannot be before manufacture" });
    }
  });

export type InventoryInput = z.input<typeof inventoryInputSchema>;
export type InventoryParsed = z.output<typeof inventoryInputSchema>;

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  code: trimmed(30),
  description: trimmed(500),
  address: trimmed(300),
  isActive: z.boolean().default(true),
});

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
