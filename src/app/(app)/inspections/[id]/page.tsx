import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getInspection } from "@/server/inspections";
import { notFoundOnError } from "@/server/pages";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KindIcon } from "@/components/status";
import { INSPECTION_OUTCOME_LABEL, STATUS_LABEL } from "@/lib/domain";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Inspection" };

export default async function InspectionPage(props: PageProps<"/inspections/[id]">) {
  const ctx = await requireOrgContext("inventory.view");
  const { id } = await props.params;
  const data = await notFoundOnError(() => withTenant(ctx.orgId, (tx) => getInspection(tx, ctx.orgId, id)));
  const i = data.inspection;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        back={{ href: "/inspections?tab=history", label: "Inspections" }}
        title={`${i.code} · ${formatDate(i.inspectedOn)}`}
        subtitle={`${data.inspectorName ?? "Platform admin"} · ${i.scope} inspection${i.notes ? ` · ${i.notes}` : ""}`}
      />
      <Card className="divide-y divide-line">
        {data.records.map((r) => (
          <Link key={r.id} href={`/inventory/${r.itemId}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface-2">
            <KindIcon kind={r.kind} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">
                <span className="font-mono text-[12px] text-muted">{r.code}</span> {r.name}
              </span>
              <span className="block text-[12.5px] text-muted">
                {STATUS_LABEL[r.previousStatus]} → {STATUS_LABEL[r.resultingStatus]}
                {r.nextInspectionDate ? ` · next ${formatDate(r.nextInspectionDate)}` : ""}
                {r.notes ? ` · ${r.notes}` : ""}
              </span>
            </span>
            <Badge tone={r.outcome === "pass" ? "green" : r.outcome === "exception" ? "neutral" : r.outcome === "fail" ? "darkred" : "red"}>
              {INSPECTION_OUTCOME_LABEL[r.outcome]}
            </Badge>
          </Link>
        ))}
      </Card>
    </div>
  );
}
