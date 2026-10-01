import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarPlus, ChevronRight, MapPin } from "lucide-react";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listReservations } from "@/server/reservations";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkTabs, Pagination, SearchInput } from "@/components/shared/url-controls";
import { ExportMenu } from "@/components/inventory/export-menu";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { RESERVATION_STATUS_LABEL } from "@/lib/domain";
import { plural } from "@/lib/utils";

export const metadata: Metadata = { title: "Reservations" };

export default async function ReservationsPage(props: PageProps<"/reservations">) {
  const ctx = await requireOrgContext("reservation.create");
  const sp = await props.searchParams;
  const tab = (["upcoming", "past", "cancelled", "all"].includes(String(sp.tab)) ? sp.tab : "upcoming") as "upcoming" | "past" | "cancelled" | "all";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const res = await withTenant(ctx.orgId, (tx) => listReservations(tx, ctx, { scope: tab, q, page: Math.max(1, Number(sp.page) || 1) }));
  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle="Equipment held for upcoming events"
        actions={
          <>
            {ctx.can("export.csv") && <ExportMenu entity="reservations" />}
            <Link href="/reservations/new" className={buttonVariants({ variant: "reserve" })}>
              <CalendarPlus /> Reserve Gear
            </Link>
          </>
        }
      />
      <LinkTabs
        param="tab"
        className="mb-4"
        layoutId="res-tabs"
        tabs={[
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
          { value: "cancelled", label: "Cancelled" },
          { value: "all", label: "All" },
        ]}
      />
      <SearchInput placeholder="Search by reservation ID or event" className="mb-4 md:max-w-sm" />
      {res.rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No reservations." action={{ label: "Reserve Gear", href: "/reservations/new" }} tone="reserve" />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {res.rows.map((r) => {
            const d = new Date(r.startsAt);
            return (
              <li key={r.id}>
                <Link
                  href={`/reservations/${r.id}`}
                  className="group flex h-full gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"
                >
                  <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-reserve/10 py-2 text-reserve">
                    <span className="text-[11px] font-bold uppercase">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
                    <span className="text-[22px] font-extrabold leading-none">{d.getDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] font-semibold text-muted">{r.code}</span>
                      <Badge tone={r.status === "confirmed" ? "purple" : r.status === "fulfilled" ? "green" : "neutral"}>{RESERVATION_STATUS_LABEL[r.status]}</Badge>
                    </span>
                    <span className="mt-1 block truncate text-[15.5px] font-bold tracking-tight">{r.eventName}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–
                      {new Date(r.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {plural(r.itemCount, "item")}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
                      <MapPin className="size-3.5" /> {r.locationName} · {r.userName}
                    </span>
                  </span>
                  <ChevronRight className="size-5 self-center text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={res.page} pageCount={res.pageCount} total={res.total} label="reservations" />
    </div>
  );
}
