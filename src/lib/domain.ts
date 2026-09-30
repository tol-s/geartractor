/** Shared, client-safe domain vocabulary. Terminology follows the Gear Tractor specification. */

export const INVENTORY_KINDS = ["component", "configuration", "kit", "consumable"] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export const KIND_LABEL: Record<InventoryKind, string> = {
  component: "Component",
  configuration: "Configuration",
  kit: "Kit",
  consumable: "Consumable",
};

export const KIND_PLURAL: Record<InventoryKind, string> = {
  component: "Components",
  configuration: "Configurations",
  kit: "Kits",
  consumable: "Consumables",
};

export const KIND_PREFIX: Record<InventoryKind, string> = {
  component: "CPT",
  configuration: "CFG",
  kit: "KIT",
  consumable: "CON",
};

export const ITEM_STATUSES = ["available", "needs_inspection", "missing", "rejected"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABEL: Record<ItemStatus, string> = {
  available: "Available",
  needs_inspection: "Needs Inspection",
  missing: "Missing",
  rejected: "Rejected",
};

/** Higher wins. Priority: Rejected, Missing, Needs Inspection. */
export const STATUS_SEVERITY: Record<ItemStatus, number> = {
  available: 0,
  needs_inspection: 1,
  missing: 2,
  rejected: 3,
};

export const AVAILABILITY = ["checked_out", "reserved", "assigned", "insufficient_stock"] as const;
export type Availability = (typeof AVAILABILITY)[number];
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  checked_out: "Checked Out",
  reserved: "Reserved",
  assigned: "Assigned",
  insufficient_stock: "Insufficient Stock",
};

export const QUANTITY_UNITS = ["units", "metres", "litres", "kg"] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];
export const UNIT_LABEL: Record<QuantityUnit, string> = {
  units: "units",
  metres: "m",
  litres: "L",
  kg: "kg",
};

export const LIFESPAN_MODES = ["finite", "explicit", "unlimited"] as const;
export type LifespanMode = (typeof LIFESPAN_MODES)[number];
export const LIFESPAN_LABEL: Record<LifespanMode, string> = {
  finite: "Finite",
  explicit: "Explicit Expiry",
  unlimited: "Unlimited",
};

export const EXPIRY_BASES = ["manufacture_date", "first_use_date"] as const;
export type ExpiryBasis = (typeof EXPIRY_BASES)[number];
export const EXPIRY_BASIS_LABEL: Record<ExpiryBasis, string> = {
  manufacture_date: "Manufacture Date",
  first_use_date: "First Use Date",
};

export const ROLES = ["super_admin", "org_admin", "trainer"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  org_admin: "Organization Admin",
  trainer: "Trainer/User",
};

export const CHECKOUT_STATUS_LABEL = {
  draft: "In Progress",
  active: "Active",
  partially_returned: "Partially Returned",
  returned: "Returned",
  cancelled: "Cancelled",
} as const;
export type CheckoutStatus = keyof typeof CHECKOUT_STATUS_LABEL;

export const CHECKOUT_ITEM_STATUS_LABEL = {
  pending: "In Basket",
  issued: "Issued",
  returned: "Returned",
  missing: "Missing",
  damaged: "Damaged",
  exception: "Exception",
} as const;
export type CheckoutItemStatus = keyof typeof CHECKOUT_ITEM_STATUS_LABEL;

export const RESERVATION_STATUS_LABEL = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  fulfilled: "Fulfilled",
} as const;

export const INSPECTION_OUTCOME_LABEL = {
  pass: "Pass",
  fail: "Fail (Rejected)",
  missing: "Missing",
  exception: "Exception (not inspected)",
} as const;
export type InspectionOutcome = keyof typeof INSPECTION_OUTCOME_LABEL;

export const CHECKOUT_STEPS = [
  { step: 1, label: "Event / Session" },
  { step: 2, label: "Trainer / User" },
  { step: 3, label: "Storage Location" },
  { step: 4, label: "Add Equipment" },
] as const;

/** Which kinds each assembly may contain as tracked children. */
export const ALLOWED_CHILDREN: Record<InventoryKind, InventoryKind[]> = {
  component: [],
  consumable: [],
  configuration: ["component", "consumable"],
  kit: ["component", "configuration", "kit", "consumable"],
};

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_CHUNK_BYTES = 3 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/jpeg", "application/pdf"] as const;
