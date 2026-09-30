import type { Metadata } from "next";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Download, FileSpreadsheet } from "lucide-react";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { checkouts, inventoryItems } from "@/db/schema";
import { listAuditLogs } from "@/server/audit-queries";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, LinkTabs, Pagination, SearchInput } from "@/components/shared/url-controls";
import { AuditTable } from "@/components/shared/audit-table";
import { ACTION_LABEL } from "@/lib/audit-labels";
import { ExportMenu } from "@/components/inventory/export-menu";
import { Card } from "@/components/ui/card";
import { KIND_PLURAL, STATUS_LABEL, INVENTORY_KINDS, ITEM_STATUSES } from "@/lib/domain";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

const STATUS_BAR: Record<string, string> = {
  available: "bg-available",
  needs_inspection: "bg-inspection",
  missing: "bg-missing",
  rejected: "bg-rejected",
};

export default async function ReportsPage(props: PageProps<"/reports">) {
  const ctx = await requireOrgContext("audit.view");
  const sp = await props.searchParams;
  const tab = sp.tab === "audit" ? "audit" : "overview";
  const data = await withTenant(ctx.orgId, async (tx) => {
    const byStatus = await tx
      .select({ status: inventoryItems.effectiveStatus, kind: inventoryItems.kind, n: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.organizationId, ctx.orgId), isNull(inventoryItems.archivedAt)))
      .groupBy(inventoryItems.effectiveStatus, inventoryItems.kind);
    const [co] = await tx
      .select({
        active: sql<number>`count(*) filter (where ${checkouts.status} in ('active','partially_returned'))::int`,
        overdue: sql<number>`count(*) filter (where ${checkouts.status} in ('active','partially_returned') and ${checkouts.dueAt} < now())::int`,
        last30: sql<number>`count(*) filter (where ${checkouts.startedAt} > now() - interval '30 days')::int`,
        returned: sql<number>`count(*) filter (where ${checkouts.status} = 'returned')::int`,
      })
      .from(checkouts)
      .where(eq(checkouts.organizationId, ctx.orgId));
    const audit =
      tab === "audit"
        ? await listAuditLogs(tx, ctx.orgId, {
            action: typeof sp.action === "string" ? sp.action : undefined,
            q: typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined,
            page: Math.max(1, Number(sp.page) || 1),
          })
        : null;
    return { byStatus, co, audit };
  });
  const total = data.byStatus.reduce((s, r) => s + Number(r.n), 0);
  const countStatus = (s: string) => data.byStatus.filter((r) => r.status === s).reduce((a, r) => a + Number(r.n), 0);
  const countKind = (k: string) => data.byStatus.filter((r) => r.kind === k).reduce((a, r) => a + Number(r.n), 0);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Inventory health, activity and audit history" />
      <LinkTabs param="tab" className="mb-5" layoutId="report-tabs" tabs={[{ value: "overview", label: "Overview" }, { value: "audit", label: "Audit history" }]} />
      {tab === "overview" ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Total inventory", v: total },
              { label: "Active checkouts", v: Number(data.co.active) },
              { label: "Overdue", v: Number(data.co.overdue), warn: Number(data.co.overdue) > 0 },
              { label: "Checkouts (30 days)", v: Number(data.co.last30) },
            ].map((x) => (
              <Card key={x.label} className="p-5">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{x.label}</p>
                <p className={cn("mt-1 text-[30px] font-bold tabular", x.warn && "text-missing")}>{x.v}</p>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-[15px] font-bold">Status</h2>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-ink/5" aria-hidden>
                {ITEM_STATUSES.map((s) => (
                  <div key={s} className={STATUS_BAR[s]} style={{ width: `${total ? (countStatus(s) / total) * 100 : 0}%` }} />
                ))}
              </div>
              <ul className="mt-4 space-y-2">
                {ITEM_STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between text-[14px]">
                    <span className="flex items-center gap-2">
                      <span className={cn("size-2.5 rounded-full", STATUS_BAR[s])} /> {STATUS_LABEL[s]}
                    </span>
                    <a href={`/inventory?status=${s}`} className="font-semibold tabular hover:text-brand">
                      {countStatus(s)}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="text-[15px] font-bold">By type</h2>
              <ul className="mt-4 space-y-3">
                {INVENTORY_KINDS.map((k) => (
                  <li key={k}>
                    <div className="flex items-center justify-between text-[14px]">
                      <span>{KIND_PLURAL[k]}</span>
                      <span className="font-semibold tabular">{countKind(k)}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink/5">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${total ? (countKind(k) / total) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-bold">
              <FileSpreadsheet className="size-5 text-available" /> CSV exports
            </h2>
            <p className="mt-1 text-[13px] text-muted">UTF-8 CSV, dates as YYYY-MM-DD. Filtered exports respect search, filters and sort on each list.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Inventory", href: "/api/export/inventory?scope=all" },
                { label: "Checkouts", href: "/api/export/checkouts?scope=all" },
                { label: "Reservations", href: "/api/export/reservations?scope=all" },
                { label: "Audit history", href: "/api/export/audit?scope=all" },
              ].map((e) => (
                <a key={e.label} href={e.href} download className="flex h-12 items-center justify-between rounded-xl border border-line-2 px-4 text-[14px] font-semibold hover:bg-surface-2">
                  {e.label} <Download className="size-4 text-muted" />
                </a>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
            <SearchInput placeholder="Search records, reasons" className="md:max-w-sm md:flex-1" />
            <FilterSelect param="action" label="Action" options={[{ value: "all", label: "All actions" }, ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))]} />
            <div className="md:ml-auto">
              <ExportMenu entity="audit" />
            </div>
          </div>
          {data.audit && (
            <>
              <AuditTable rows={data.audit.rows} showEntity />
              <Pagination page={data.audit.page} pageCount={data.audit.pageCount} total={data.audit.total} label="entries" />
            </>
          )}
        </div>
      )}
    </div>
  );
}
