import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ChevronRight, ClipboardCheck, History, PackageCheck, PackageOpen } from "lucide-react";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getDashboard } from "@/server/dashboard";
import { recentActivity } from "@/server/audit-queries";
import { PageHeader } from "@/components/shared/page-header";
import { SectionTitle, Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckoutStatusBadge } from "@/components/status";
import { ACTION_LABEL } from "@/lib/audit-labels";
import { formatDateTime, plural, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const ctx = await requireOrgContext();
  const { dash, feed } = await withTenant(ctx.orgId, async (tx) => ({
    dash: await getDashboard(tx, ctx),
    feed: await recentActivity(tx, ctx.orgId, { userId: ctx.can("audit.view") ? undefined : ctx.user.id, limit: 30 }),
  }));
  const links = [
    { href: "/checkouts", label: "Checkouts", icon: PackageOpen, tone: "bg-brand/10 text-brand" },
    { href: "/check-in", label: "Check In", icon: PackageCheck, tone: "bg-checkin/10 text-checkin" },
    { href: "/reservations", label: "Reservations", icon: CalendarClock, tone: "bg-reserve/10 text-reserve" },
    { href: "/inspections", label: "Inspections", icon: ClipboardCheck, tone: "bg-inspection/12 text-[#b45309]" },
  ];
  return (
    <div className="space-y-7">
      <PageHeader title="Activity" subtitle="Sessions, reservations and recent changes" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] active:scale-[0.98]">
            <span className={`flex size-10 items-center justify-center rounded-xl ${l.tone}`}>
              <l.icon className="size-5" />
            </span>
            <span className="text-[14px] font-semibold">{l.label}</span>
          </Link>
        ))}
      </div>
      {dash.inProgress && (
        <Link href={`/checkouts/${dash.inProgress.id}/edit`} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[#e8dfd0] bg-warm p-4">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">In Progress Checkout</span>
            <span className="block text-[13.5px] text-ink-2">
              Step {dash.inProgress.step} of 4 – {dash.inProgress.context}
            </span>
          </span>
          <ChevronRight className="size-5" />
        </Link>
      )}
      <section className="space-y-3">
        <SectionTitle title="Active Sessions" subtitle={`${plural(dash.activeCount, "session")} with equipment out`} />
        {dash.activeSessions.length === 0 ? (
          <Card className="p-5 text-[14px] text-muted">No active checkout sessions.</Card>
        ) : (
          <Card className="divide-y divide-line">
            {dash.activeSessions.map((s) => (
              <Link key={s.id} href={`/checkouts/${s.id}`} className="flex items-center gap-3 p-4 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">{s.eventName}</span>
                  <span className="block text-[12.5px] text-muted">
                    {s.locationName} · {plural(s.itemsOut, "item")} out · {timeAgo(s.startedAt)}
                  </span>
                </span>
                <CheckoutStatusBadge status={s.status} overdue={Boolean(s.dueAt && s.dueAt < new Date())} />
              </Link>
            ))}
          </Card>
        )}
      </section>
      {dash.upcoming.length > 0 && (
        <section className="space-y-3">
          <SectionTitle title="Upcoming Reservations" />
          <Card className="divide-y divide-line">
            {dash.upcoming.map((r) => (
              <Link key={r.id} href={`/reservations/${r.id}`} className="flex items-center gap-3 p-4 hover:bg-surface-2">
                <CalendarClock className="size-5 text-reserve" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">{r.eventName}</span>
                  <span className="block text-[12.5px] text-muted">
                    {formatDateTime(r.startsAt)} · {r.locationName}
                  </span>
                </span>
                <ChevronRight className="size-5 text-muted" />
              </Link>
            ))}
          </Card>
        </section>
      )}
      <section className="space-y-3">
        <SectionTitle title="Recent Activity" />
        {feed.length === 0 ? (
          <Card className="p-5 text-[14px] text-muted">No recent activity.</Card>
        ) : (
          <Card className="p-5">
            <ol>
              {feed.map((f) => (
                <li key={f.id} className="relative border-l-2 border-line pb-4 pl-5 last:pb-0">
                  <span className="absolute -left-[7px] top-1 size-3 rounded-full border-2 border-surface bg-brand" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{ACTION_LABEL[f.action] ?? f.action}</Badge>
                    <span className="text-[12.5px] text-muted">
                      <History className="mr-1 inline size-3.5" />
                      {timeAgo(f.createdAt)} · {f.actorName ?? "System"}
                    </span>
                  </div>
                  <p className="mt-1 text-[14px] font-medium">
                    {f.entityId && ["component", "configuration", "kit", "consumable"].includes(f.entityType) ? (
                      <Link href={`/inventory/${f.entityId}`} className="hover:text-brand">
                        {f.entityLabel}
                      </Link>
                    ) : f.entityId && f.entityType === "checkout" ? (
                      <Link href={`/checkouts/${f.entityId}`} className="hover:text-brand">
                        {f.entityLabel}
                      </Link>
                    ) : f.entityId && f.entityType === "reservation" ? (
                      <Link href={`/reservations/${f.entityId}`} className="hover:text-brand">
                        {f.entityLabel}
                      </Link>
                    ) : (
                      f.entityLabel
                    )}
                  </p>
                  {f.reason && <p className="text-[13px] text-muted">{f.reason}</p>}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>
    </div>
  );
}
