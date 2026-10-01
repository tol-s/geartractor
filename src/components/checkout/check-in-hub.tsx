"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, MapPin, PackageSearch, ScanLine } from "lucide-react";
import { findCheckoutByScanAction } from "@/app/actions/checkout";
import { plural, timeAgo } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { EmptyState } from "../shared/empty-state";
import { SectionTitle } from "../ui/card";
import { CheckoutStatusBadge } from "../status";
import { ScannerOverlay } from "../scan/qr-scanner";
import type { CheckoutStatus } from "@/lib/domain";

type Session = {
  id: string;
  code: string;
  eventName: string | null;
  status: CheckoutStatus;
  dueAt: Date | null;
  startedAt: Date | null;
  locationName: string | null;
  userName: string | null;
  itemsOut: number;
};

export function CheckInHub({ sessions }: { sessions: Session[] }) {
  const router = useRouter();
  const [scanOpen, setScanOpen] = React.useState(false);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Check In Gear" subtitle="Return equipment by scanning it or picking the checkout session." back={{ href: "/dashboard", label: "Dashboard" }} />
      <motion.button
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setScanOpen(true)}
        className="relative mb-8 flex w-full items-center gap-4 overflow-hidden rounded-[var(--radius-tile)] bg-checkin p-5 text-left text-white md:p-6"
      >
        <span className="grid-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <span className="relative flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-white/20 ring-1 ring-white/25">
          <ScanLine className="size-7" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-[20px] font-extrabold uppercase tracking-tight">Scan QR</span>
          <span className="block text-[14px] text-white/85">Scan any returned item to open its session</span>
        </span>
        <ChevronRight className="relative size-6" />
      </motion.button>

      <SectionTitle title="Select Active Checkout" subtitle="Currently checked-out equipment" className="mb-4" />
      {sessions.length === 0 ? (
        <EmptyState icon={PackageSearch} title="No active checkout sessions." description="Nothing is waiting to be returned." action={{ label: "Start Checkout", href: "/checkouts/new" }} tone="checkin" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sessions.map((s) => {
            const overdue = Boolean(s.dueAt && new Date(s.dueAt) < new Date());
            return (
              <li key={s.id}>
                <Link href={`/checkouts/${s.id}/return`} className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                      <MapPin className="size-4 text-reserve" /> {s.locationName}
                    </span>
                    <CheckoutStatusBadge status={s.status} overdue={overdue} />
                  </div>
                  <p className="mt-2 text-[16px] font-bold tracking-tight">{s.eventName}</p>
                  <div className="mt-auto flex items-center justify-between pt-3 text-[13px] text-muted">
                    <span>
                      <span className="font-semibold text-ink-2">{plural(s.itemsOut, "item")} out</span> · {s.userName} · {timeAgo(s.startedAt)}
                    </span>
                    <ChevronRight className="size-5" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <ScannerOverlay
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title="Scan returned equipment"
        onScan={async (text) => {
          const r = await findCheckoutByScanAction(text);
          if (!r.ok) return { ok: false, message: r.error.message };
          setTimeout(() => router.push(`/checkouts/${r.data.checkoutId}/return?line=${r.data.lineId}`), 700);
          return { ok: true, message: "Found. Opening check-in..." };
        }}
      />
    </div>
  );
}
