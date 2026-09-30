import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getDashboard } from "@/server/dashboard";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const ctx = await requireOrgContext();
  const sp = await props.searchParams;
  const data = await withTenant(ctx.orgId, (tx) => getDashboard(tx, ctx));
  return (
    <DashboardView
      userName={ctx.user.name}
      data={data}
      denied={sp.denied === "1"}
      canInspect={ctx.can("inspection.perform")}
      canManage={ctx.can("inventory.manage")}
    />
  );
}
