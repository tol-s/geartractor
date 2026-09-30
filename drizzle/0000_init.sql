CREATE TYPE "public"."attachment_status" AS ENUM('uploading', 'ready');--> statement-breakpoint
CREATE TYPE "public"."checkout_item_status" AS ENUM('pending', 'issued', 'returned', 'missing', 'damaged', 'exception');--> statement-breakpoint
CREATE TYPE "public"."checkout_status" AS ENUM('draft', 'active', 'partially_returned', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."consumable_movement_type" AS ENUM('receive', 'adjustment', 'allocate', 'release', 'issue', 'return_unused', 'consumed', 'loss');--> statement-breakpoint
CREATE TYPE "public"."expiry_basis" AS ENUM('manufacture_date', 'first_use_date');--> statement-breakpoint
CREATE TYPE "public"."inspection_outcome" AS ENUM('pass', 'fail', 'missing', 'exception');--> statement-breakpoint
CREATE TYPE "public"."inspection_scope" AS ENUM('individual', 'bulk', 'assembly');--> statement-breakpoint
CREATE TYPE "public"."inventory_kind" AS ENUM('component', 'configuration', 'kit', 'consumable');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('available', 'needs_inspection', 'missing', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."lifespan_mode" AS ENUM('finite', 'explicit', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."quantity_unit" AS ENUM('units', 'metres', 'litres', 'kg');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('confirmed', 'cancelled', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'org_admin', 'trainer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'deactivated');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_item_id" uuid NOT NULL,
	"child_item_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"unassigned_at" timestamp with time zone,
	"unassigned_by" uuid,
	CONSTRAINT "assignments_no_self" CHECK ("assignments"."parent_item_id" <> "assignments"."child_item_id")
);
--> statement-breakpoint
CREATE TABLE "attachment_chunks" (
	"organization_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "attachment_chunks_attachment_id_idx_pk" PRIMARY KEY("attachment_id","idx")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"status" "attachment_status" DEFAULT 'uploading' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_max_size" CHECK ("attachments"."size_bytes" > 0 AND "attachments"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_label" text,
	"previous" jsonb,
	"next" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"parent_checkout_item_id" uuid,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"quantity" numeric(14, 3) DEFAULT 1 NOT NULL,
	"status" "checkout_item_status" DEFAULT 'pending' NOT NULL,
	"returned_unused" numeric(14, 3) DEFAULT 0 NOT NULL,
	"consumed" numeric(14, 3) DEFAULT 0 NOT NULL,
	"lost" numeric(14, 3) DEFAULT 0 NOT NULL,
	"return_note" text,
	"returned_at" timestamp with time zone,
	"returned_by" uuid,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"event_name" text,
	"user_id" uuid,
	"created_by" uuid NOT NULL,
	"location_id" uuid,
	"reservation_id" uuid,
	"status" "checkout_status" DEFAULT 'draft' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_sequences" (
	"organization_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "code_sequences_organization_id_prefix_pk" PRIMARY KEY("organization_id","prefix")
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"inventory_item_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumable_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"consumable_item_id" uuid NOT NULL,
	"parent_item_id" uuid NOT NULL,
	"required_quantity" numeric(14, 3) NOT NULL,
	"allocated_quantity" numeric(14, 3) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "allocations_positive" CHECK ("consumable_allocations"."required_quantity" > 0 AND "consumable_allocations"."allocated_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "consumable_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"consumable_item_id" uuid NOT NULL,
	"type" "consumable_movement_type" NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"total_after" numeric(14, 3) NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumable_stock" (
	"inventory_item_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"total_quantity" numeric(14, 3) DEFAULT 0 NOT NULL,
	"allocated_quantity" numeric(14, 3) DEFAULT 0 NOT NULL,
	"issued_quantity" numeric(14, 3) DEFAULT 0 NOT NULL,
	"unused_returned_total" numeric(14, 3) DEFAULT 0 NOT NULL,
	"consumed_total" numeric(14, 3) DEFAULT 0 NOT NULL,
	"loss_total" numeric(14, 3) DEFAULT 0 NOT NULL,
	"adjustments_total" numeric(14, 3) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_non_negative" CHECK ("consumable_stock"."total_quantity" >= 0 AND "consumable_stock"."allocated_quantity" >= 0 AND "consumable_stock"."issued_quantity" >= 0),
	CONSTRAINT "stock_no_over_allocation" CHECK ("consumable_stock"."allocated_quantity" + "consumable_stock"."issued_quantity" <= "consumable_stock"."total_quantity")
);
--> statement-breakpoint
CREATE TABLE "inspection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"outcome" "inspection_outcome" NOT NULL,
	"previous_status" "item_status" NOT NULL,
	"resulting_status" "item_status" NOT NULL,
	"next_inspection_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"inspector_id" uuid,
	"inspected_on" date NOT NULL,
	"scope" "inspection_scope" NOT NULL,
	"root_item_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_item_tags" (
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "inventory_item_tags_item_id_tag_id_pk" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "inventory_kind" NOT NULL,
	"name" text NOT NULL,
	"serial_number" text,
	"tech_spec" text,
	"manufacturer" text,
	"location_id" uuid,
	"status" "item_status" DEFAULT 'available' NOT NULL,
	"manufacture_date" date,
	"first_use_date" date,
	"lifespan_mode" "lifespan_mode" DEFAULT 'unlimited' NOT NULL,
	"lifespan_months" integer,
	"expiry_basis" "expiry_basis",
	"explicit_expiry" date,
	"annual_inspection_required" boolean DEFAULT false NOT NULL,
	"inspection_interval_months" integer DEFAULT 12 NOT NULL,
	"last_inspection_date" date,
	"next_inspection_date" date,
	"last_use_date" date,
	"technical_details" text,
	"notes" text,
	"quantity_unit" "quantity_unit",
	"reorder_threshold" numeric(14, 3),
	"computed_expiry" date,
	"effective_status" "item_status" DEFAULT 'available' NOT NULL,
	"status_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkout_blocked" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_consumable_unit_check" CHECK (("inventory_items"."kind" = 'consumable') = ("inventory_items"."quantity_unit" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748B' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "kit_contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kit_item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kits" (
	"inventory_item_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"logo_data_url" text,
	"primary_color" text DEFAULT '#FF6B1A' NOT NULL,
	"secondary_color" text DEFAULT '#2563EB' NOT NULL,
	"accent_color" text DEFAULT '#E11D74' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_recomputed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"token" text NOT NULL,
	"last_printed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_inventory_item_id_unique" UNIQUE("inventory_item_id"),
	CONSTRAINT "qr_codes_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT 1 NOT NULL,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"event_name" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by" uuid,
	"location_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'confirmed' NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_time_order" CHECK ("reservations"."ends_at" > "reservations"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"previous_status" "item_status",
	"new_status" "item_status" NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'trainer' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"phone" text,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_overdue" boolean DEFAULT true NOT NULL,
	"notify_inspections" boolean DEFAULT true NOT NULL,
	"last_active_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_org_check" CHECK (("users"."role" = 'super_admin' AND "users"."organization_id" IS NULL) OR ("users"."role" <> 'super_admin' AND "users"."organization_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_parent_item_id_inventory_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_child_item_id_inventory_items_id_fk" FOREIGN KEY ("child_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_unassigned_by_users_id_fk" FOREIGN KEY ("unassigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_chunks" ADD CONSTRAINT "attachment_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_chunks" ADD CONSTRAINT "attachment_chunks_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_sequences" ADD CONSTRAINT "code_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_allocations" ADD CONSTRAINT "consumable_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_allocations" ADD CONSTRAINT "consumable_allocations_consumable_item_id_inventory_items_id_fk" FOREIGN KEY ("consumable_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_allocations" ADD CONSTRAINT "consumable_allocations_parent_item_id_inventory_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_allocations" ADD CONSTRAINT "consumable_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_consumable_item_id_inventory_items_id_fk" FOREIGN KEY ("consumable_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_stock" ADD CONSTRAINT "consumable_stock_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_stock" ADD CONSTRAINT "consumable_stock_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_root_item_id_inventory_items_id_fk" FOREIGN KEY ("root_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_tags" ADD CONSTRAINT "inventory_item_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_tags" ADD CONSTRAINT "inventory_item_tags_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_tags" ADD CONSTRAINT "inventory_item_tags_tag_id_inventory_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."inventory_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_tags" ADD CONSTRAINT "inventory_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_contents" ADD CONSTRAINT "kit_contents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_contents" ADD CONSTRAINT "kit_contents_kit_item_id_inventory_items_id_fk" FOREIGN KEY ("kit_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kits" ADD CONSTRAINT "kits_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kits" ADD CONSTRAINT "kits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_active_child_unique" ON "assignments" USING btree ("child_item_id") WHERE "assignments"."unassigned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assignments_parent_idx" ON "assignments" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "attachments_item_idx" ON "attachments" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_items_unique" ON "checkout_items" USING btree ("checkout_id","inventory_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_items_one_issued" ON "checkout_items" USING btree ("inventory_item_id") WHERE "checkout_items"."status" = 'issued' AND "checkout_items"."is_tracked";--> statement-breakpoint
CREATE INDEX "checkout_items_item_idx" ON "checkout_items" USING btree ("inventory_item_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "checkouts_org_code_unique" ON "checkouts" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "checkouts_org_status_idx" ON "checkouts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "checkouts_creator_idx" ON "checkouts" USING btree ("created_by","status");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_active_unique" ON "consumable_allocations" USING btree ("consumable_item_id","parent_item_id") WHERE "consumable_allocations"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "allocations_parent_idx" ON "consumable_allocations" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "movements_item_idx" ON "consumable_movements" USING btree ("consumable_item_id","created_at");--> statement-breakpoint
CREATE INDEX "inspection_records_item_idx" ON "inspection_records" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "inspection_records_inspection_idx" ON "inspection_records" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "inspections_org_idx" ON "inspections" USING btree ("organization_id","inspected_on");--> statement-breakpoint
CREATE INDEX "item_tags_tag_idx" ON "inventory_item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_org_code_unique" ON "inventory_items" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "inventory_org_kind_idx" ON "inventory_items" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "inventory_org_status_idx" ON "inventory_items" USING btree ("organization_id","effective_status");--> statement-breakpoint
CREATE INDEX "inventory_org_location_idx" ON "inventory_items" USING btree ("organization_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_org_name_idx" ON "inventory_items" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_unique" ON "inventory_tags" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "kit_contents_kit_idx" ON "kit_contents" USING btree ("kit_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_name_unique" ON "locations" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_items_unique" ON "reservation_items" USING btree ("reservation_id","inventory_item_id");--> statement-breakpoint
CREATE INDEX "reservation_items_item_idx" ON "reservation_items" USING btree ("inventory_item_id","starts_at");--> statement-breakpoint
CREATE INDEX "reservations_org_time_idx" ON "reservations" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "status_history_item_idx" ON "status_history" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");