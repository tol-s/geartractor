import { listOrgChoices, requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { ensureFreshStatuses } from "@/server/status-engine";
import { AppShell } from "@/components/shell/app-shell";
import { BrandStyle } from "@/components/shell/brand-style";
import type { Permission } from "@/server/auth/permissions";

const NAV_PERMISSIONS: Record<string, Permission> = {
  "/dashboard": "inventory.view",
  "/inventory": "inventory.view",
  "/configurations": "inventory.view",
  "/kits": "inventory.view",
  "/consumables": "inventory.view",
  "/checkouts": "checkout.create",
  "/reservations": "reservation.create",
  "/inspections": "inventory.view",
  "/locations": "inventory.view",
  "/users": "users.manage",
  "/reports": "audit.view",
  "/settings": "org.settings",
};

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireOrgContext();
  // Time-based rules (expiry, inspection due dates) are refreshed once per day per tenant.
  await withTenant(ctx.orgId, (tx) => ensureFreshStatuses(tx, ctx.orgId));
  const orgs = await listOrgChoices(ctx);
  const allowed = Object.entries(NAV_PERMISSIONS)
    .filter(([, p]) => ctx.can(p))
    .map(([href]) => href);
  return (
    <>
      <BrandStyle primary={ctx.org.primaryColor} secondary={ctx.org.secondaryColor} accent={ctx.org.accentColor} />
      <AppShell
        user={{ name: ctx.user.name, email: ctx.user.email, role: ctx.isSuperAdmin ? "super_admin" : ctx.role }}
        org={{ id: ctx.orgId, name: ctx.org.name, logo: ctx.org.logoDataUrl }}
        orgs={orgs}
        isSuperAdmin={ctx.isSuperAdmin}
        allowed={allowed}
      >
        {children}
      </AppShell>
    </>
  );
}
