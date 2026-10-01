import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const userRole = pgEnum("user_role", ["super_admin", "org_admin", "trainer"]);
export const userStatus = pgEnum("user_status", ["active", "invited", "deactivated"]);
export const orgStatus = pgEnum("org_status", ["active", "inactive"]);
export const inventoryKind = pgEnum("inventory_kind", [
  "component",
  "configuration",
  "kit",
  "consumable",
]);
export const itemStatus = pgEnum("item_status", [
  "available",
  "needs_inspection",
  "missing",
  "rejected",
]);
export const lifespanMode = pgEnum("lifespan_mode", ["finite", "explicit", "unlimited"]);
export const expiryBasis = pgEnum("expiry_basis", ["manufacture_date", "first_use_date"]);
export const quantityUnit = pgEnum("quantity_unit", ["units", "metres", "litres", "kg"]);
export const checkoutStatus = pgEnum("checkout_status", [
  "draft",
  "active",
  "partially_returned",
  "returned",
  "cancelled",
]);
export const checkoutItemStatus = pgEnum("checkout_item_status", [
  "pending",
  "issued",
  "returned",
  "missing",
  "damaged",
  "exception",
]);
export const reservationStatus = pgEnum("reservation_status", [
  "confirmed",
  "cancelled",
  "fulfilled",
]);
export const inspectionScope = pgEnum("inspection_scope", ["individual", "bulk", "assembly"]);
export const inspectionOutcome = pgEnum("inspection_outcome", [
  "pass",
  "fail",
  "missing",
  "exception",
]);
export const consumableMovementType = pgEnum("consumable_movement_type", [
  "receive",
  "adjustment",
  "allocate",
  "release",
  "issue",
  "return_unused",
  "consumed",
  "loss",
]);
export const attachmentStatus = pgEnum("attachment_status", ["uploading", "ready"]);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "number" });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* ------------------------------------------------------------------ */
/* Platform                                                            */
/* ------------------------------------------------------------------ */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: orgStatus("status").notNull().default("active"),
  logoDataUrl: text("logo_data_url"),
  primaryColor: text("primary_color").notNull().default("#FF6B1A"),
  secondaryColor: text("secondary_color").notNull().default("#2563EB"),
  accentColor: text("accent_color").notNull().default("#E11D74"),
  timezone: text("timezone").notNull().default("UTC"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
  statusRecomputedOn: date("status_recomputed_on"),
  ...timestamps,
});

export type OrgSettings = {
  /** Trainers may record inspection outcomes (otherwise they can only report issues). */
  trainersCanInspect?: boolean;
  /** Org admins may explicitly check out equipment reserved for another session. */
  allowReservedOverride?: boolean;
  /** Default number of days before a checkout is considered overdue. */
  defaultCheckoutDays?: number;
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("trainer"),
    status: userStatus("status").notNull().default("active"),
    phone: text("phone"),
    notifyEmail: boolean("notify_email").notNull().default(true),
    notifyOverdue: boolean("notify_overdue").notNull().default(true),
    notifyInspections: boolean("notify_inspections").notNull().default(true),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
    index("users_org_idx").on(t.organizationId),
    check(
      "users_role_org_check",
      sql`(${t.role} = 'super_admin' AND ${t.organizationId} IS NULL) OR (${t.role} <> 'super_admin' AND ${t.organizationId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Additional organizations a user belongs to, beyond their home organization
 * (`users.organization_id`). The role here applies inside that organization only.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRole("role").notNull().default("trainer"),
    status: userStatus("status").notNull().default("active"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("organization_members_unique").on(t.organizationId, t.userId),
    index("organization_members_user_idx").on(t.userId),
    check("organization_members_role_check", sql`${t.role} <> 'super_admin'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token)
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(), // sha256(token)
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: userRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitations_org_idx").on(t.organizationId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export const codeSequences = pgTable(
  "code_sequences",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.prefix] })],
);

/* ------------------------------------------------------------------ */
/* Tenant: locations & inventory                                       */
/* ------------------------------------------------------------------ */

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    description: text("description"),
    address: text("address"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("locations_org_name_unique").on(t.organizationId, sql`lower(${t.name})`)],
);

export type StatusReason = {
  code:
    | "flagged"
    | "missing"
    | "rejected"
    | "expired"
    | "inspection_overdue"
    | "inspection_missing"
    | "expiry_info_missing"
    | "consumable_shortage"
    | "child";
  label: string;
  severity: "rejected" | "missing" | "needs_inspection" | "blocker";
  sourceItemId?: string;
  sourceCode?: string;
  path?: string[];
};

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    kind: inventoryKind("kind").notNull(),
    name: text("name").notNull(),
    serialNumber: text("serial_number"),
    techSpec: text("tech_spec"),
    manufacturer: text("manufacturer"),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "restrict" }),
    status: itemStatus("status").notNull().default("available"),

    manufactureDate: date("manufacture_date"),
    firstUseDate: date("first_use_date"),
    lifespanMode: lifespanMode("lifespan_mode").notNull().default("unlimited"),
    lifespanMonths: integer("lifespan_months"),
    expiryBasis: expiryBasis("expiry_basis"),
    explicitExpiry: date("explicit_expiry"),

    annualInspectionRequired: boolean("annual_inspection_required").notNull().default(false),
    inspectionIntervalMonths: integer("inspection_interval_months").notNull().default(12),
    lastInspectionDate: date("last_inspection_date"),
    nextInspectionDate: date("next_inspection_date"),
    lastUseDate: date("last_use_date"),

    technicalDetails: text("technical_details"),
    notes: text("notes"),

    quantityUnit: quantityUnit("quantity_unit"),
    reorderThreshold: qty("reorder_threshold"),

    // Derived, recomputed by the status engine inside the mutating transaction.
    computedExpiry: date("computed_expiry"),
    effectiveStatus: itemStatus("effective_status").notNull().default("available"),
    statusReasons: jsonb("status_reasons").$type<StatusReason[]>().notNull().default([]),
    checkoutBlocked: boolean("checkout_blocked").notNull().default(false),

    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("inventory_org_code_unique").on(t.organizationId, t.code),
    index("inventory_org_kind_idx").on(t.organizationId, t.kind),
    index("inventory_org_status_idx").on(t.organizationId, t.effectiveStatus),
    index("inventory_org_location_idx").on(t.organizationId, t.locationId),
    index("inventory_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    check(
      "inventory_consumable_unit_check",
      sql`(${t.kind} = 'consumable') = (${t.quantityUnit} IS NOT NULL)`,
    ),
  ],
);

export const inventoryTags = pgTable(
  "inventory_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#64748B"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tags_org_name_unique").on(t.organizationId, sql`lower(${t.name})`)],
);

export const inventoryItemTags = pgTable(
  "inventory_item_tags",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => inventoryTags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] }), index("item_tags_tag_idx").on(t.tagId)],
);

export const configurations = pgTable("configurations", {
  inventoryItemId: uuid("inventory_item_id")
    .primaryKey()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  purpose: text("purpose"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kits = pgTable("kits", {
  inventoryItemId: uuid("inventory_item_id")
    .primaryKey()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  purpose: text("purpose"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tracked parent/child relationships. A child has at most one active immediate parent. */
export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentItemId: uuid("parent_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    childItemId: uuid("child_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
    unassignedBy: uuid("unassigned_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("assignments_active_child_unique")
      .on(t.childItemId)
      .where(sql`${t.unassignedAt} IS NULL`),
    index("assignments_parent_idx").on(t.parentItemId),
    check("assignments_no_self", sql`${t.parentItemId} <> ${t.childItemId}`),
  ],
);

/** Descriptive-only kit contents (no stock, QR or inspection history). */
export const kitContents = pgTable(
  "kit_contents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kitItemId: uuid("kit_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: text("quantity"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kit_contents_kit_idx").on(t.kitItemId)],
);

export const consumableStock = pgTable(
  "consumable_stock",
  {
    inventoryItemId: uuid("inventory_item_id")
      .primaryKey()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    totalQuantity: qty("total_quantity").notNull().default(0),
    allocatedQuantity: qty("allocated_quantity").notNull().default(0),
    issuedQuantity: qty("issued_quantity").notNull().default(0),
    unusedReturnedTotal: qty("unused_returned_total").notNull().default(0),
    consumedTotal: qty("consumed_total").notNull().default(0),
    lossTotal: qty("loss_total").notNull().default(0),
    adjustmentsTotal: qty("adjustments_total").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("stock_non_negative", sql`${t.totalQuantity} >= 0 AND ${t.allocatedQuantity} >= 0 AND ${t.issuedQuantity} >= 0`),
    check(
      "stock_no_over_allocation",
      sql`${t.allocatedQuantity} + ${t.issuedQuantity} <= ${t.totalQuantity}`,
    ),
  ],
);

export const consumableAllocations = pgTable(
  "consumable_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    consumableItemId: uuid("consumable_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    parentItemId: uuid("parent_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    requiredQuantity: qty("required_quantity").notNull(),
    allocatedQuantity: qty("allocated_quantity").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("allocations_active_unique")
      .on(t.consumableItemId, t.parentItemId)
      .where(sql`${t.releasedAt} IS NULL`),
    index("allocations_parent_idx").on(t.parentItemId),
    check("allocations_positive", sql`${t.requiredQuantity} > 0 AND ${t.allocatedQuantity} >= 0`),
  ],
);

export const consumableMovements = pgTable(
  "consumable_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    consumableItemId: uuid("consumable_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    type: consumableMovementType("type").notNull(),
    quantity: qty("quantity").notNull(),
    totalAfter: qty("total_after").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    note: text("note"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("movements_item_idx").on(t.consumableItemId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Inspections                                                         */
/* ------------------------------------------------------------------ */

export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    inspectorId: uuid("inspector_id").references(() => users.id, { onDelete: "set null" }),
    inspectedOn: date("inspected_on").notNull(),
    scope: inspectionScope("scope").notNull(),
    rootItemId: uuid("root_item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inspections_org_idx").on(t.organizationId, t.inspectedOn)],
);

export const inspectionRecords = pgTable(
  "inspection_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inspectionId: uuid("inspection_id")
      .notNull()
      .references(() => inspections.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    outcome: inspectionOutcome("outcome").notNull(),
    previousStatus: itemStatus("previous_status").notNull(),
    resultingStatus: itemStatus("resulting_status").notNull(),
    nextInspectionDate: date("next_inspection_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inspection_records_item_idx").on(t.inventoryItemId, t.createdAt),
    index("inspection_records_inspection_idx").on(t.inspectionId),
  ],
);

/* ------------------------------------------------------------------ */
/* Checkouts & reservations                                            */
/* ------------------------------------------------------------------ */

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    eventName: text("event_name").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: reservationStatus("status").notNull().default("confirmed"),
    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("reservations_org_time_idx").on(t.organizationId, t.startsAt),
    check("reservations_time_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const reservationItems = pgTable(
  "reservation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    quantity: qty("quantity").notNull().default(1),
    isTracked: boolean("is_tracked").notNull().default(true),
    // Denormalised from the reservation so the exclusion constraint can prevent double booking.
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("reservation_items_unique").on(t.reservationId, t.inventoryItemId),
    index("reservation_items_item_idx").on(t.inventoryItemId, t.startsAt),
  ],
);

export const checkouts = pgTable(
  "checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    eventName: text("event_name"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    status: checkoutStatus("status").notNull().default("draft"),
    currentStep: integer("current_step").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("checkouts_org_code_unique").on(t.organizationId, t.code),
    index("checkouts_org_status_idx").on(t.organizationId, t.status),
    index("checkouts_creator_idx").on(t.createdBy, t.status),
  ],
);

export const checkoutItems = pgTable(
  "checkout_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => checkouts.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    parentCheckoutItemId: uuid("parent_checkout_item_id"),
    isTracked: boolean("is_tracked").notNull().default(true),
    quantity: qty("quantity").notNull().default(1),
    status: checkoutItemStatus("status").notNull().default("pending"),
    returnedUnused: qty("returned_unused").notNull().default(0),
    consumed: qty("consumed").notNull().default(0),
    lost: qty("lost").notNull().default(0),
    returnNote: text("return_note"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedBy: uuid("returned_by").references(() => users.id, { onDelete: "set null" }),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Repeated scans never duplicate a basket line; a tracked item appears once per checkout.
    // (A consumable may appear both directly and inside an assembly allocation.)
    uniqueIndex("checkout_items_root_unique")
      .on(t.checkoutId, t.inventoryItemId)
      .where(sql`${t.parentCheckoutItemId} IS NULL`),
    uniqueIndex("checkout_items_tracked_unique")
      .on(t.checkoutId, t.inventoryItemId)
      .where(sql`${t.isTracked}`),
    // Database-level guarantee: a tracked item can be issued in at most one checkout.
    uniqueIndex("checkout_items_one_issued")
      .on(t.inventoryItemId)
      .where(sql`${t.status} = 'issued' AND ${t.isTracked}`),
    index("checkout_items_item_idx").on(t.inventoryItemId, t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Attachments, QR, audit                                              */
/* ------------------------------------------------------------------ */

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    status: attachmentStatus("status").notNull().default("uploading"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("attachments_item_idx").on(t.inventoryItemId),
    check("attachments_max_size", sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`),
  ],
);

export const attachmentChunks = pgTable(
  "attachment_chunks",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.attachmentId, t.idx] })],
);

export const qrCodes = pgTable(
  "qr_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .unique()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    lastPrintedAt: timestamp("last_printed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    previous: jsonb("previous"),
    next: jsonb("next"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_entity_idx").on(t.entityId, t.createdAt),
  ],
);

export const statusHistory = pgTable(
  "status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    previousStatus: itemStatus("previous_status"),
    newStatus: itemStatus("new_status").notNull(),
    reason: text("reason"),
    source: text("source").notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("status_history_item_idx").on(t.inventoryItemId, t.createdAt)],
);

/** Tables that carry organization_id and are protected by row-level security. */
export const TENANT_TABLES = [
  "locations",
  "inventory_items",
  "inventory_tags",
  "inventory_item_tags",
  "configurations",
  "kits",
  "assignments",
  "kit_contents",
  "consumable_stock",
  "consumable_allocations",
  "consumable_movements",
  "inspections",
  "inspection_records",
  "reservations",
  "reservation_items",
  "checkouts",
  "checkout_items",
  "attachments",
  "attachment_chunks",
  "qr_codes",
  "status_history",
  "invitations",
  "code_sequences",
] as const;
