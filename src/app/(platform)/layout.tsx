import { requireSuperAdmin, getOrgContext, listOrgChoices } from "@/server/auth/context";
import { PLATFORM_ORG_ID } from "@/components/shell/platform";
import { AppShell } from "@/components/shell/app-shell";
import { BrandStyle } from "@/components/shell/brand-style";

const ALL = ["/dashboard", "/inventory", "/configurations", "/kits", "/consumables", "/checkouts", "/reservations", "/inspections", "/locations", "/users", "/reports", "/settings"];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperAdmin();
  const ctx = await getOrgContext();
  const orgs = await listOrgChoices({ user: session.user, isSuperAdmin: true });
  return (
    <>
      {ctx && <BrandStyle primary={ctx.org.primaryColor} secondary={ctx.org.secondaryColor} accent={ctx.org.accentColor} />}
      <AppShell
        user={{ name: session.user.name, email: session.user.email, role: "super_admin" }}
        org={{ id: ctx?.orgId ?? PLATFORM_ORG_ID, name: ctx?.org.name ?? "Platform", logo: ctx?.org.logoDataUrl ?? null }}
        orgs={orgs}
        isSuperAdmin
        allowed={ctx ? ALL : []}
      >
        {children}
      </AppShell>
    </>
  );
}
