import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { buildInspectionSheet } from "@/server/inspections";
import { orgToday } from "@/server/status-engine";
import { notFoundOnError } from "@/server/pages";
import { InspectionSheet } from "@/components/inspections/inspection-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { ClipboardCheck } from "lucide-react";

export const metadata: Metadata = { title: "New Inspection" };

export default async function NewInspectionPage(props: PageProps<"/inspections/new">) {
  const ctx = await requireOrgContext("inspection.perform");
  const sp = await props.searchParams;
  const root = typeof sp.root === "string" ? sp.root : null;
  const items = typeof sp.items === "string" ? sp.items.split(",").filter((i) => /^[0-9a-f-]{36}$/i.test(i)) : [];
  const data = await notFoundOnError(() =>
    withTenant(ctx.orgId, async (tx) => ({
      sheet: await buildInspectionSheet(tx, ctx.orgId, { rootItemId: root, itemIds: items }),
      today: await orgToday(tx, ctx.orgId),
    })),
  );
  if (!data.sheet.items.length) {
    return <EmptyState icon={ClipboardCheck} title="Choose equipment to inspect" description="Start an inspection from an item, or select several items in Inspections." action={{ label: "View Inspections", href: "/inspections" }} />;
  }
  return <InspectionSheet sheet={data.sheet} today={data.today} />;
}
