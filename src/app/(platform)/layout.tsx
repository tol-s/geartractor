import { requireSuperAdmin, getOrgContext } from "@/server/auth/context";
import { AppShell } from "@/components/shell/app-shell";
import { BrandStyle } from "@/components/shell/brand-style";

const ALL = ["/dashboard", "/inventory", "/configurations", "/kits", "/consumables", "/checkouts", "/reservations", "/inspections", "/locations", "/users", "/reports", "/settings"];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperAdmin();
  const ctx = await getOrgContext();
  return (
    <>
      {ctx && <BrandStyle primary={ctx.org.primaryColor} secondary={ctx.org.secondaryColor} accent={ctx.org.accentColor} />}
      <AppShell
        user={{ name: session.user.name, email: session.user.email, role: "super_admin" }}
        org={{ name: ctx?.org.name ?? "Platform", logo: ctx?.org.logoDataUrl ?? null }}
        isSuperAdmin
        allowed={ctx ? ALL : []}
      >
        {children}
      </AppShell>
    </>
  );
}
