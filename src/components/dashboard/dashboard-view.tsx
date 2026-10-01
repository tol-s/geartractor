"use client";

import * as React from "react";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  CalendarPlus,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Droplets,
  MapPin,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  ScanLine,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { DashboardData } from "@/server/dashboard";
import { cn, plural, timeAgo } from "@/lib/utils";
import { CheckoutStatusBadge } from "../status";

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 340, damping: 30 } },
};

/**
 * Operational dashboard: what can I do, what is out, what needs attention, what is in progress.
 * Flat SaaS styling: bordered surfaces, solid icon tiles, no shadows.
 */
export function DashboardView({
  userName,
  data,
  denied,
}: {
  userName: string;
  data: DashboardData;
  denied?: boolean;
  canInspect?: boolean;
  canManage?: boolean;
}) {
  React.useEffect(() => {
    if (denied) toast.error("Not allowed", { description: "You do not have permission to open that page.", id: "denied" });
  }, [denied]);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6 lg:space-y-7">
      {/* Welcome */}
      <motion.section variants={item} className="flex flex-col items-center gap-3 text-center lg:flex-row lg:items-end lg:justify-between lg:text-left">
        <div>
          <p className="text-[14px] font-medium text-muted">
            Welcome back! <span aria-hidden>👋</span>
          </p>
          <h1 className="mt-0.5 text-[26px] font-bold leading-tight tracking-[-0.025em] text-ink lg:text-[30px]">{userName}</h1>
          <p className="mt-1 hidden text-[13.5px] text-muted lg:block">
            {data.orgName} · {today}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/checkouts?status=active"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-available/25 bg-available/10 px-3.5 text-[13px] font-semibold text-[#15803d] transition-colors hover:bg-available/15"
          >
            <span className="relative flex size-2">
              {data.activeCount > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-available opacity-60" />}
              <span className="relative inline-flex size-2 rounded-full bg-available" />
            </span>
            {plural(data.activeCount, "active session")}
          </Link>
          <Link
            href="/scan"
            className="hidden h-9 items-center gap-2 rounded-full border border-line-2 bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-2 lg:inline-flex"
          >
            <ScanLine className="size-4" /> Scan
          </Link>
        </div>
      </motion.section>

      {/* Primary actions */}
      <motion.section variants={item} aria-label="Primary actions" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <ActionTile
          href="/checkouts/new"
          title="Check Out Gear"
          subtitle="Take equipment out"
          icon={PackageOpen}
          tone="checkout"
          className="col-span-2 lg:col-span-1"
          wide
        />
        <ActionTile href="/reservations/new" title="Reserve Gear" subtitle="Reserve equipment" icon={CalendarPlus} tone="reserve" />
        <ActionTile href="/check-in" title="Check In Gear" subtitle="Return equipment" icon={PackageCheck} tone="checkin" />
      </motion.section>

      {/* Desktop shows the KPI row here; on mobile it follows the alerts to keep the spec order. */}
      <motion.section variants={item} className="hidden lg:block">
        <Stats stats={data.stats} />
      </motion.section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <motion.div variants={item}>
            <InProgress data={data} />
          </motion.div>
          <motion.div variants={item}>
            <ActiveSessions data={data} />
          </motion.div>
        </div>
        <div className="min-w-0 space-y-6">
          <motion.div variants={item}>
            <Attention alerts={data.alerts} />
          </motion.div>
          <motion.div variants={item} className="lg:hidden">
            <Stats stats={data.stats} />
          </motion.div>
          <motion.div variants={item}>
            <Upcoming upcoming={data.upcoming} />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

const TONE = {
  checkout: { bg: "bg-checkout", text: "text-checkout" },
  reserve: { bg: "bg-reserve", text: "text-reserve" },
  checkin: { bg: "bg-checkin", text: "text-checkin" },
} as const;

function ActionTile({
  href,
  title,
  subtitle,
  icon: Icon,
  tone,
  wide,
  className,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: keyof typeof TONE;
  wide?: boolean;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <motion.div className={className} whileTap={{ scale: 0.98 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
      <Link
        href={href}
        aria-label={`${title}: ${subtitle}`}
        className={cn(
          "group flex h-full gap-3 rounded-2xl p-4 text-white outline-offset-4 transition-[filter] hover:brightness-[1.06]",
          t.bg,
          wide ? "items-center" : "flex-col items-start lg:flex-row lg:items-center",
        )}
      >
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl bg-white", t.text)}>
          <Icon className="size-[22px]" strokeWidth={2.4} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-bold leading-tight tracking-[-0.01em]">{title}</span>
          <span className="mt-0.5 block text-[13px] font-medium text-white/85">{subtitle}</span>
        </span>
        <ArrowRight
          className={cn("size-5 shrink-0 text-white/80 transition-transform group-hover:translate-x-0.5", !wide && "hidden lg:block")}
          aria-hidden
        />
      </Link>
    </motion.div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 lg:px-5">
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle && <p className="text-[12.5px] text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold text-muted hover:bg-ink/5 hover:text-ink"
    >
      View all <ChevronRight className="size-4" />
    </Link>
  );
}

function IconTile({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px] text-white", className)}>
      <Icon className="size-[18px]" strokeWidth={2.3} aria-hidden />
    </span>
  );
}

function Stats({ stats }: { stats: DashboardData["stats"] }) {
  const items: { label: string; value: number; href: string; icon: LucideIcon; tone: string }[] = [
    { label: "Total equipment", value: stats.total, href: "/inventory", icon: Boxes, tone: "bg-ink" },
    { label: "Available", value: stats.available, href: "/inventory?status=available", icon: CircleCheck, tone: "bg-available" },
    { label: "Checked out", value: stats.checkedOut, href: "/inventory?availability=checked_out", icon: PackageOpen, tone: "bg-checked-out" },
    { label: "Needs attention", value: stats.attention, href: "/inspections", icon: TriangleAlert, tone: "bg-inspection" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((s) => (
        <Link
          key={s.label}
          href={s.href}
          className="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-2 hover:bg-surface-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-muted">{s.label}</span>
            <IconTile icon={s.icon} className={s.tone} />
          </div>
          <p className="mt-2 text-[26px] font-bold leading-none tracking-tight text-ink tabular">{s.value}</p>
        </Link>
      ))}
    </div>
  );
}

function InProgress({ data }: { data: DashboardData }) {
  if (!data.inProgress) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-2 bg-surface px-4 py-3.5">
        <IconTile icon={Clock} className="bg-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold text-ink">No checkout in progress</p>
          <Link href="/checkouts/new" className="text-[13.5px] font-semibold text-brand hover:underline">
            Start a new checkout
          </Link>
        </div>
      </div>
    );
  }
  const p = data.inProgress;
  return (
    <Link
      href={`/checkouts/${p.id}/edit`}
      className="group flex items-center gap-4 rounded-2xl border border-[#eadfcd] bg-warm px-4 py-3.5 transition-colors hover:border-[#dccbb0] lg:px-5"
    >
      <IconTile icon={Clock} className="size-11 rounded-xl bg-brand" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold tracking-tight text-ink">In Progress Checkout</p>
        <p className="truncate text-[13.5px] text-ink-2">
          Step {p.step} of {p.totalSteps} – {p.context}
        </p>
        <div className="mt-2 flex max-w-[220px] gap-1" aria-hidden>
          {Array.from({ length: p.totalSteps }).map((_, i) => (
            <span key={i} className={cn("h-1 flex-1 rounded-full", i < p.step ? "bg-brand" : "bg-ink/10")} />
          ))}
        </div>
      </div>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#dccbb0] bg-surface text-ink transition-transform group-hover:translate-x-0.5">
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}

function ActiveSessions({ data }: { data: DashboardData }) {
  return (
    <Panel
      title="Active Sessions"
      subtitle="Currently checked-out equipment"
      action={data.activeCount > 0 ? <ViewAll href="/checkouts?status=active" /> : undefined}
    >
      {data.activeSessions.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <IconTile icon={PackageSearch} className="size-11 rounded-xl bg-brand" />
          <p className="mt-3 text-[14.5px] font-semibold">No active checkout sessions.</p>
          <Link href="/checkouts/new" className="mt-3 inline-flex h-10 items-center rounded-xl bg-ink px-4 text-[14px] font-semibold text-white">
            Start Checkout
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {data.activeSessions.slice(0, 8).map((s) => {
            const overdue = s.dueAt ? new Date(s.dueAt) < new Date() : false;
            return (
              <li key={s.id}>
                <Link href={`/checkouts/${s.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 lg:px-5">
                  <IconTile icon={MapPin} className={overdue ? "bg-missing" : "bg-reserve"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">{s.eventName}</p>
                    <p className="truncate text-[12.5px] text-muted">
                      {s.locationName} · <span className="font-medium text-ink-2">{plural(s.itemsOut, "item")} out</span> · {timeAgo(s.startedAt)}
                      {s.userName ? <span className="hidden sm:inline"> · {s.userName}</span> : null}
                    </p>
                  </div>
                  <CheckoutStatusBadge status={s.status} overdue={overdue} />
                  <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Attention({ alerts }: { alerts: DashboardData["alerts"] }) {
  const list: { key: string; title: string; text: string; count: number; href: string; icon: LucideIcon; tone: string }[] = [];
  if (alerts.needsInspection > 0)
    list.push({
      key: "insp",
      title: "Needs Inspection",
      text: `${plural(alerts.needsInspection, "item")} ${alerts.needsInspection === 1 ? "needs" : "need"} inspection`,
      count: alerts.needsInspection,
      href: "/inspections",
      icon: ClipboardCheck,
      tone: "bg-inspection",
    });
  if (alerts.lowStock > 0)
    list.push({
      key: "stock",
      title: "Low Stock",
      text: `${plural(alerts.lowStock, "consumable")} below reorder threshold`,
      count: alerts.lowStock,
      href: "/consumables?availability=insufficient_stock",
      icon: Droplets,
      tone: "bg-consumable",
    });
  if (alerts.overdue > 0)
    list.push({
      key: "overdue",
      title: "Overdue Returns",
      text: `${plural(alerts.overdue, "checkout session")} ${alerts.overdue === 1 ? "is" : "are"} overdue`,
      count: alerts.overdue,
      href: "/checkouts?status=overdue",
      icon: Clock,
      tone: "bg-missing",
    });
  if (alerts.missing > 0)
    list.push({
      key: "missing",
      title: "Missing Equipment",
      text: `${plural(alerts.missing, "item")} reported missing`,
      count: alerts.missing,
      href: "/inventory?status=missing",
      icon: TriangleAlert,
      tone: "bg-rejected",
    });
  if (!list.length) {
    return (
      <Panel title="Needs Attention">
        <div className="flex items-center gap-3 px-4 py-4 lg:px-5">
          <IconTile icon={CircleCheck} className="bg-available" />
          <p className="text-[13.5px] text-ink-2">Nothing needs attention. All equipment is in order.</p>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Needs Attention" subtitle="Actionable alerts">
      <ul className="divide-y divide-line">
        {list.map((a) => (
          <li key={a.key}>
            <Link href={a.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 lg:px-5">
              <IconTile icon={a.icon} className={a.tone} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">{a.title}</p>
                <p className="truncate text-[12.5px] text-muted">{a.text}</p>
              </div>
              <span className="rounded-lg bg-ink/[0.06] px-2 py-0.5 text-[13px] font-bold text-ink tabular">{a.count}</span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Upcoming({ upcoming }: { upcoming: DashboardData["upcoming"] }) {
  return (
    <Panel title="Upcoming Reservations" action={<ViewAll href="/reservations" />}>
      {upcoming.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-4 lg:px-5">
          <IconTile icon={CalendarClock} className="bg-reserve" />
          <p className="text-[13.5px] text-ink-2">No reservations.</p>
          <Link href="/reservations/new" className="ml-auto text-[13px] font-semibold text-reserve hover:underline">
            Reserve Gear
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {upcoming.map((r) => {
            const d = new Date(r.startsAt);
            return (
              <li key={r.id}>
                <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 lg:px-5">
                  <span className="flex w-10 shrink-0 flex-col items-center justify-center rounded-[10px] bg-reserve py-1 text-white">
                    <span className="text-[10px] font-bold uppercase leading-tight">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
                    <span className="text-[15px] font-extrabold leading-tight">{d.getDate()}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">{r.eventName}</p>
                    <p className="truncate text-[12.5px] text-muted">
                      {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {r.locationName}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
