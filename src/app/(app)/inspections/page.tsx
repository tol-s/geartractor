import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listAttentionItems, listInspections } from "@/server/inspections";
import { InspectionsView } from "@/components/inspections/inspections-view";

export const metadata: Metadata = { title: "Inspections" };

export default async function InspectionsPage(props: PageProps<"/inspections">) {
  const ctx = await requireOrgContext("inventory.view");
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await withTenant(ctx.orgId, async (tx) => ({
    attention: await listAttentionItems(tx, ctx.orgId),
    history: await listInspections(tx, ctx.orgId, page),
  }));
  return <InspectionsView attention={data.attention} history={data.history} canInspect={ctx.can("inspection.perform")} tab={sp.tab === "history" ? "history" : "attention"} />;
}
