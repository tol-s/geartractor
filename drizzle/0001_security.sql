-- Gear Tractor: database-level tenant isolation and integrity guarantees.
--
-- Every tenant-owned table is protected by row-level security. The application sets
-- `app.org_id` (transaction-local) from the authenticated session before any query.
-- Platform-level operations (authentication, super admin) set `app.bypass = on`.
-- FORCE ROW LEVEL SECURITY applies the policies to the table owner as well.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gt_current_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.org_id', true), '')::uuid
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gt_bypass() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('app.bypass', true), '') = 'on'
  $$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'locations','inventory_items','inventory_tags','inventory_item_tags','configurations','kits',
    'assignments','kit_contents','consumable_stock','consumable_allocations','consumable_movements',
    'inspections','inspection_records','reservations','reservation_items','checkouts','checkout_items',
    'attachments','attachment_chunks','qr_codes','status_history','invitations','code_sequences',
    'users','audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (gt_bypass() OR organization_id = gt_current_org()) WITH CHECK (gt_bypass() OR organization_id = gt_current_org())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations
  USING (gt_bypass() OR id = gt_current_org())
  WITH CHECK (gt_bypass() OR id = gt_current_org());
--> statement-breakpoint
-- Assembly structure: checkout items reference their parent line (descendants of a Kit/Configuration).
ALTER TABLE checkout_items
  ADD CONSTRAINT checkout_items_parent_fk FOREIGN KEY (parent_checkout_item_id)
  REFERENCES checkout_items(id) ON DELETE CASCADE;
--> statement-breakpoint
-- Double booking is impossible at the database level: a tracked item cannot be part of two
-- active reservations whose time windows overlap.
ALTER TABLE reservation_items
  ADD CONSTRAINT reservation_items_no_overlap EXCLUDE USING gist (
    inventory_item_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (active AND is_tracked);
--> statement-breakpoint
-- Tenant consistency: relationships may never cross organizations.
CREATE OR REPLACE FUNCTION gt_assert_same_org() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_org uuid;
  child_org uuid;
BEGIN
  IF TG_TABLE_NAME = 'assignments' THEN
    SELECT organization_id INTO parent_org FROM inventory_items WHERE id = NEW.parent_item_id;
    SELECT organization_id INTO child_org FROM inventory_items WHERE id = NEW.child_item_id;
  ELSIF TG_TABLE_NAME = 'consumable_allocations' THEN
    SELECT organization_id INTO parent_org FROM inventory_items WHERE id = NEW.parent_item_id;
    SELECT organization_id INTO child_org FROM inventory_items WHERE id = NEW.consumable_item_id;
  ELSIF TG_TABLE_NAME = 'checkout_items' THEN
    SELECT organization_id INTO parent_org FROM checkouts WHERE id = NEW.checkout_id;
    SELECT organization_id INTO child_org FROM inventory_items WHERE id = NEW.inventory_item_id;
  ELSIF TG_TABLE_NAME = 'reservation_items' THEN
    SELECT organization_id INTO parent_org FROM reservations WHERE id = NEW.reservation_id;
    SELECT organization_id INTO child_org FROM inventory_items WHERE id = NEW.inventory_item_id;
  END IF;
  IF parent_org IS DISTINCT FROM NEW.organization_id OR child_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'cross-tenant reference rejected' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER assignments_same_org BEFORE INSERT OR UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION gt_assert_same_org();
--> statement-breakpoint
CREATE TRIGGER allocations_same_org BEFORE INSERT OR UPDATE ON consumable_allocations
  FOR EACH ROW EXECUTE FUNCTION gt_assert_same_org();
--> statement-breakpoint
CREATE TRIGGER checkout_items_same_org BEFORE INSERT OR UPDATE ON checkout_items
  FOR EACH ROW EXECUTE FUNCTION gt_assert_same_org();
--> statement-breakpoint
CREATE TRIGGER reservation_items_same_org BEFORE INSERT OR UPDATE ON reservation_items
  FOR EACH ROW EXECUTE FUNCTION gt_assert_same_org();
