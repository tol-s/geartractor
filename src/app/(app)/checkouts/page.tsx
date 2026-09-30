import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MapPin, PackageCheck, PackageOpen, PackageSearch } from "lucide-react";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listCheckouts } from "@/server/checkout";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkTabs, Pagination, SearchInput } from "@/components/shared/url-controls";
import { ExportMenu } from "@/components/inventory/export-menu";
import { CheckoutStatusBadge } from "@/components/status";
import { buttonVariants } from "@/components/ui/button-variants";
import { formatDateTime, plural, timeAgo } from "@/lib/utils";
import { CHECKOUT_STEPS } from "@/lib/domain";

export const metadata: Metadata = { title: "Checkouts" };

export default async function CheckoutsPage(props: PageProps<"/checkouts">) {
  const ctx = await requireOrgContext("checkout.create");
  const sp = await props.searchParams;
  const status = (["active", "draft", "returned", "overdue", "all"].includes(String(sp.status)) ? sp.status : "active") as "active" | "draft" | "returned" | "overdue" | "all";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const res = await withTenant(ctx.orgId, (tx) => listCheckouts(tx, ctx, { status, q, page }));
  return (
    <div>
      <PageHeader
        title="Checkouts"
        subtitle={ctx.can("checkout.manage_all") ? "All checkout sessions in your organization" : "Your checkout sessions"}
        actions={
          <>
            {ctx.can("export.csv") && <ExportMenu entity="checkouts" />}
            <Link href="/check-in" className={buttonVariants({ variant: "checkin" })}>
              <PackageCheck /> Check In
            </Link>
            <Link href="/checkouts/new" className={buttonVariants({ variant: "brand" })}>
              <PackageOpen /> Start Checkout
            </Link>
          </>
        }
      />
      <LinkTabs
        param="status"
        className="mb-4"
        tabs={[
          { value: "active", label: "Active" },
          { value: "draft", label: "In Progress" },
          { value: "overdue", label: "Overdue" },
          { value: "returned", label: "Returned" },
          { value: "all", label: "All" },
        ]}
      />
      <SearchInput placeholder="Search by session ID or event" className="mb-4 md:max-w-sm" />
      {res.rows.length === 0 ? (
        <EmptyState icon={PackageSearch} title={status === "active" ? "No active checkout sessions." : "No checkouts found"} action={{ label: "Start Checkout", href: "/checkouts/new" }} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {res.rows.map((r) => {
            const overdue = Boolean(r.dueAt && r.dueAt < new Date() && (r.status === "active" || r.status === "partially_returned"));
            const href = r.status === "draft" ? `/checkouts/${r.id}/edit` : `/checkouts/${r.id}`;
            return (
              <li key={r.id}>
                <Link href={href} className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] md:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-muted">{r.code}</span>
                    <CheckoutStatusBadge status={r.status} overdue={overdue} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[16px] font-bold tracking-tight">{r.eventName ?? "Untitled checkout"}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
                    <MapPin className="size-3.5" /> {r.locationName ?? "Location not selected"}
                    {r.userName && <span>· {r.userName}</span>}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-4 text-[13px] text-muted">
                    <span>
                      {r.status === "draft" ? (
                        <>Step {Math.min(r.currentStep, 4)} of 4 – {CHECKOUT_STEPS[Math.min(r.currentStep, 4) - 1].label}</>
                      ) : r.status === "returned" ? (
                        <>Returned {formatDateTime(r.completedAt)}</>
                      ) : (
                        <>
                          <span className="font-semibold text-ink-2">{plural(r.itemsOut, "item")} out</span> · {timeAgo(r.startedAt)}
                        </>
                      )}
                    </span>
                    <ChevronRight className="size-5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={res.page} pageCount={res.pageCount} total={res.total} label="sessions" />
    </div>
  );
}
