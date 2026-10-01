"use client";

import * as React from "react";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CalendarPlus,
  ChevronRight,
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
import { cn, formatDateTime, plural, timeAgo } from "@/lib/utils";
import { SectionTitle } from "../ui/card";
import { EmptyState } from "../shared/empty-state";
import { CheckoutStatusBadge } from "../status";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 28 } },
};

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

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8 md:space-y-10">
      {/* Welcome */}
      <motion.section variants={item} className="flex flex-col items-center text-center md:items-start md:text-left">
        <p className="text-[15px] font-medium text-muted">
          Welcome back! <span aria-hidden>👋</span>
        </p>
        <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.03em] text-ink md:text-[38px]">{userName}</h1>
        <Link
          href="/checkouts?status=active"
          className="mt-3 inline-flex h-8 items-center gap-2 rounded-full bg-available/12 px-3.5 text-[13px] font-semibold text-[#15803d] transition-colors hover:bg-available/20"
        >
          <span className="relative flex size-2">
            {data.activeCount > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-available opacity-60" />}
            <span className="relative inline-flex size-2 rounded-full bg-available" />
          </span>
          {plural(data.activeCount, "active session")}
        </Link>
      </motion.section>

      {/* Primary actions */}
      <motion.section variants={item} aria-label="Primary actions" className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
        <ActionTile
          href="/checkouts/new"
          title="Check Out Gear"
          subtitle="Take equipment out"
          icon={PackageOpen}
          tone="checkout"
          cta="Start Checkout"
          className="col-span-2 md:col-span-1"
          primary
        />
        <ActionTile href="/reservations/new" title="Reserve Gear" subtitle="Reserve equipment" icon={CalendarPlus} tone="reserve" cta="Reserve" />
        <ActionTile href="/check-in" title="Check In Gear" subtitle="Return equipment" icon={PackageCheck} tone="checkin" cta="Check In" />
      </motion.section>

      {/* In progress checkout */}
      <motion.section variants={item} aria-label="In progress checkout">
        {data.inProgress ? (
          <Link href={`/checkouts/${data.inProgress.id}/edit`} className="group block">
            <motion.div
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[#e8dfd0] bg-warm p-4 shadow-[var(--shadow-card)] transition-shadow group-hover:shadow-[var(--shadow-lift)] md:p-5"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white md:size-14">
                <Clock className="size-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-bold tracking-tight text-ink md:text-[17px]">In Progress Checkout</p>
                <p className="truncate text-[14px] text-ink-2">
                  Step {data.inProgress.step} of {data.inProgress.totalSteps} – {data.inProgress.context}
                </p>
                <div className="mt-2.5 flex max-w-[260px] gap-1.5" aria-hidden>
                  {Array.from({ length: data.inProgress.totalSteps }).map((_, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < data.inProgress!.step ? "bg-brand" : "bg-ink/10")} />
                  ))}
                </div>
              </div>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-ink shadow-sm transition-transform group-hover:translate-x-1">
                <ArrowRight className="size-5" aria-hidden />
              </span>
            </motion.div>
          </Link>
        ) : (
          <div className="flex items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface/60 p-4 md:p-5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink/[0.05] text-muted">
              <Clock className="size-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">No checkout in progress</p>
              <Link href="/checkouts/new" className="text-[14px] font-semibold text-brand hover:underline">
                Start a new checkout
              </Link>
            </div>
          </div>
        )}
      </motion.section>

      {/* Active sessions */}
      <motion.section variants={item} aria-label="Active sessions" className="space-y-4">
        <SectionTitle
          title="Active Sessions"
          subtitle="Currently checked-out equipment"
          action={
            data.activeCount > 0 ? (
              <Link href="/checkouts?status=active" className="text-[13px] font-semibold text-muted hover:text-ink">
                View all
              </Link>
            ) : null
          }
        />
        {data.activeSessions.length === 0 ? (
          <EmptyState icon={PackageSearch} title="No active checkout sessions." action={{ label: "Start Checkout", href: "/checkouts/new" }} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.activeSessions.map((s, i) => {
              const overdue = s.dueAt ? new Date(s.dueAt) < new Date() : false;
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.05 }}
                >
                  <Link href={`/checkouts/${s.id}`} className="group block h-full">
                    <motion.div
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.985 }}
                      className="flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow group-hover:shadow-[var(--shadow-lift)] md:p-5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-ink">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-reserve/10 text-reserve">
                            <MapPin className="size-4" aria-hidden />
                          </span>
                          <span className="truncate">{s.locationName ?? "No location"}</span>
                        </span>
                        <CheckoutStatusBadge status={s.status} overdue={overdue} />
                      </div>
                      <p className="mt-3 line-clamp-2 text-[16px] font-bold leading-snug tracking-tight text-ink">{s.eventName}</p>
                      <div className="mt-auto flex items-center justify-between pt-4 text-[13px] text-muted">
                        <span>
                          <span className="font-semibold text-ink-2">{plural(s.itemsOut, "item")} out</span>
                          <span className="mx-1.5">·</span>
                          {timeAgo(s.startedAt)}
                        </span>
                        <ChevronRight className="size-5 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </div>
                    </motion.div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.section>

      {/* Alerts (only relevant ones) */}
      <Alerts alerts={data.alerts} />

      {data.upcoming.length > 0 && (
        <motion.section variants={item} className="space-y-4" aria-label="Upcoming reservations">
          <SectionTitle
            title="Upcoming Reservations"
            action={
              <Link href="/reservations" className="text-[13px] font-semibold text-muted hover:text-ink">
                View all
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.upcoming.map((r) => (
              <Link
                key={r.id}
                href={`/reservations/${r.id}`}
                className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)]"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-reserve/10 text-reserve">
                  <CalendarClock className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{r.eventName}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {formatDateTime(r.startsAt)} · {r.locationName}
                  </span>
                </span>
                <ChevronRight className="size-5 text-muted" aria-hidden />
              </Link>
            ))}
          </div>
        </motion.section>
      )}

      {/* Mobile quick scan */}
      <motion.div variants={item} className="lg:hidden">
        <Link
          href="/scan"
          className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line-2 bg-surface text-[15px] font-semibold text-ink shadow-[var(--shadow-card)] active:scale-[0.99]"
        >
          <ScanLine className="size-5" aria-hidden /> Scan equipment QR
        </Link>
      </motion.div>
    </motion.div>
  );
}

const TILE_TONE = {
  checkout: "bg-checkout text-white shadow-[0_18px_40px_-18px_var(--brand)]",
  reserve: "bg-reserve text-white shadow-[0_18px_40px_-18px_var(--brand-2)]",
  checkin: "bg-checkin text-white shadow-[0_18px_40px_-18px_var(--brand-3)]",
} as const;

function ActionTile({
  href,
  title,
  subtitle,
  icon: Icon,
  tone,
  cta,
  primary,
  className,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: keyof typeof TILE_TONE;
  cta: string;
  primary?: boolean;
  className?: string;
}) {
  return (
    <motion.div className={className} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
      <Link
        href={href}
        aria-label={`${title}: ${subtitle}`}
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-tile)] p-4 outline-offset-4 md:min-h-[232px] md:p-6",
          primary ? "min-h-[176px]" : "min-h-[164px]",
          TILE_TONE[tone],
        )}
      >
        <span className="grid-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <Icon
          className={cn(
            "pointer-events-none absolute -bottom-6 -right-6 text-white/[0.12] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110",
            primary ? "size-44 md:size-48" : "size-32 md:size-48",
          )}
          strokeWidth={1.5}
          aria-hidden
        />
        <span
          className={cn(
            "relative flex items-center justify-center rounded-[18px] bg-white/20 ring-1 ring-white/25 backdrop-blur-sm",
            primary ? "size-14 md:size-16" : "size-12 md:size-16",
          )}
        >
          <Icon className={cn(primary ? "size-7 md:size-8" : "size-6 md:size-8")} strokeWidth={2.1} aria-hidden />
        </span>
        <span className="relative mt-auto pt-5">
          <span className={cn("block font-extrabold uppercase leading-[1.05] tracking-[-0.01em]", primary ? "text-[26px] md:text-[26px]" : "text-[19px] md:text-[26px]")}>
            {title}
          </span>
          <span className="mt-1 block text-[13px] font-medium text-white/85 md:text-[15px]">{subtitle}</span>
        </span>
        <span className="relative mt-4 hidden items-center gap-1.5 self-start rounded-full bg-white/95 px-3.5 py-2 text-[13px] font-bold text-ink shadow-sm transition-transform group-hover:translate-x-0.5 md:inline-flex">
          {cta}
          <ArrowUpRight className="size-4" aria-hidden />
        </span>
        {primary && (
          <span className="relative mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-white/95 px-3.5 py-2 text-[13px] font-bold text-ink shadow-sm md:hidden">
            {cta}
            <ArrowUpRight className="size-4" aria-hidden />
          </span>
        )}
      </Link>
    </motion.div>
  );
}

function Alerts({ alerts }: { alerts: DashboardData["alerts"] }) {
  const list: { key: string; title: string; text: string; href: string; icon: LucideIcon; tone: string }[] = [];
  if (alerts.needsInspection > 0)
    list.push({
      key: "insp",
      title: "Needs Inspection",
      text: `${plural(alerts.needsInspection, "item")} ${alerts.needsInspection === 1 ? "needs" : "need"} inspection`,
      href: "/inspections",
      icon: ClipboardCheck,
      tone: "bg-inspection/12 text-[#b45309]",
    });
  if (alerts.lowStock > 0)
    list.push({
      key: "stock",
      title: "Low Stock",
      text: `${plural(alerts.lowStock, "consumable")} below reorder threshold`,
      href: "/consumables?availability=insufficient_stock",
      icon: Droplets,
      tone: "bg-consumable/12 text-[#c2410c]",
    });
  if (alerts.overdue > 0)
    list.push({
      key: "overdue",
      title: "Overdue Returns",
      text: `${plural(alerts.overdue, "checkout session")} ${alerts.overdue === 1 ? "is" : "are"} overdue`,
      href: "/checkouts?status=overdue",
      icon: Clock,
      tone: "bg-missing/10 text-missing",
    });
  if (alerts.missing > 0)
    list.push({
      key: "missing",
      title: "Missing Equipment",
      text: `${plural(alerts.missing, "item")} reported missing`,
      href: "/inventory?status=missing",
      icon: TriangleAlert,
      tone: "bg-missing/10 text-missing",
    });
  if (!list.length) return null;
  return (
    <motion.section variants={item} className="space-y-4" aria-label="Alerts">
      <SectionTitle title="Needs Attention" subtitle="Actionable alerts" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((a) => (
          <Link key={a.key} href={a.href} className="group">
            <motion.div
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.985 }}
              className="flex h-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow group-hover:shadow-[var(--shadow-lift)]"
            >
              <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", a.tone)}>
                <a.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-ink">{a.title}</span>
                <span className="block text-[13px] leading-snug text-muted">{a.text}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
            </motion.div>
          </Link>
        ))}
      </div>
    </motion.section>
  );
}
