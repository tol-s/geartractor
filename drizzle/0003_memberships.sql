CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'trainer' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_role_check" CHECK ("organization_members"."role" <> 'super_admin')
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
-- Memberships are tenant data: an organization only ever sees its own member rows.
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organization_members
  USING (gt_bypass() OR organization_id = gt_current_org())
  WITH CHECK (gt_bypass() OR organization_id = gt_current_org());
--> statement-breakpoint
-- Members of the current organization are readable (names on checkouts, assignment pickers),
-- but a user row can only be written by its home organization.
DROP POLICY IF EXISTS tenant_isolation ON users;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON users
  USING (
    gt_bypass()
    OR organization_id = gt_current_org()
    OR EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = users.id AND m.organization_id = gt_current_org())
  )
  WITH CHECK (gt_bypass() OR organization_id = gt_current_org());
--> statement-breakpoint
-- A membership must point at another organization than the user's home one, and never at a platform admin.
CREATE OR REPLACE FUNCTION gt_assert_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  home uuid;
  r user_role;
BEGIN
  SELECT organization_id, role INTO home, r FROM users WHERE id = NEW.user_id;
  IF r = 'super_admin' THEN
    RAISE EXCEPTION 'platform administrators cannot hold organization memberships' USING ERRCODE = 'check_violation';
  END IF;
  IF home = NEW.organization_id THEN
    RAISE EXCEPTION 'user already belongs to this organization' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER organization_members_assert BEFORE INSERT OR UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION gt_assert_membership();
--> statement-breakpoint
-- Looks up an account by email across organizations (RLS hides other tenants' users). Used when an
-- Organization Admin adds someone who already has a Gear Tractor account. Never returns secrets.
CREATE OR REPLACE FUNCTION gt_find_user_by_email(p_email text)
  RETURNS TABLE (id uuid, organization_id uuid, role user_role, name text, email text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.organization_id, u.role, u.name, u.email FROM users u WHERE lower(u.email) = lower(p_email) LIMIT 1
  $$;
