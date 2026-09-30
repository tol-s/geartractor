"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { CalendarPlus, Check, PackageCheck, PackageOpen, ScanLine, ShieldCheck } from "lucide-react";
import { LogoMark } from "../shell/logo";

/** Split-screen auth layout: animated product visual on desktop, centred card on mobile. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar text-white lg:flex lg:flex-col">
        <div className="grid-dots absolute inset-0 opacity-50" aria-hidden />
        <motion.div
          aria-hidden
          className="absolute -left-40 -top-40 size-[520px] rounded-full bg-brand/40 blur-[120px]"
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-48 right-[-120px] size-[520px] rounded-full bg-brand-3/30 blur-[120px]"
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute right-1/4 top-1/3 size-[300px] rounded-full bg-brand-2/25 blur-[110px]"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative flex items-center gap-3 px-12 pt-10">
          <LogoMark size={40} />
          <span className="text-[19px] font-bold tracking-[-0.02em]">Gear Tractor</span>
        </div>
        <div className="relative flex flex-1 items-center px-12">
          <EquipmentIllustration />
        </div>
        <div className="relative px-12 pb-12">
          <h2 className="max-w-md text-[34px] font-bold leading-[1.1] tracking-[-0.03em]">
            Every component, kit and consumable. <span className="text-brand">Accounted for.</span>
          </h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60">
            Scan, check out, reserve, return and inspect equipment in seconds, with complete history for every item.
          </p>
        </div>
      </aside>
      <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-5 py-10 sm:px-8">
        <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
          <LogoMark size={56} />
          <span className="text-[22px] font-bold tracking-[-0.02em]">Gear Tractor</span>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[420px]"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

function EquipmentIllustration() {
  const tiles = [
    { icon: PackageOpen, label: "Check Out", bg: "bg-brand" },
    { icon: CalendarPlus, label: "Reserve", bg: "bg-brand-2" },
    { icon: PackageCheck, label: "Check In", bg: "bg-brand-3" },
  ];
  return (
    <div className="relative w-full max-w-[520px]">
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t, i) => (
          <motion.div
            key={t.label}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: [0, -6, 0] }}
            transition={{ opacity: { delay: 0.2 + i * 0.1 }, y: { delay: i * 0.4, duration: 5, repeat: Infinity, ease: "easeInOut" } }}
            className={`${t.bg} flex aspect-[4/5] flex-col justify-between rounded-[24px] p-4 shadow-2xl`}
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/20">
              <t.icon className="size-6" />
            </span>
            <span className="text-[15px] font-extrabold uppercase leading-tight">{t.label}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.6 }}
        className="relative -mt-6 ml-10 mr-6 rounded-[22px] border border-white/10 bg-white/[0.08] p-4 backdrop-blur-xl"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15">
            <ScanLine className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">KIT-000001 · Field Kit</p>
            <p className="text-[12px] text-white/55">4 components · 3 consumables</p>
          </div>
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 1.1, type: "spring", stiffness: 400, damping: 15 }}
            className="flex size-8 items-center justify-center rounded-full bg-available"
          >
            <Check className="size-4" strokeWidth={3} />
          </motion.span>
        </div>
        <div className="mt-3 flex gap-2">
          <span className="rounded-full bg-available/25 px-2.5 py-1 text-[11px] font-semibold text-green-200">Available</span>
          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
            <ShieldCheck className="size-3" /> Inspected
          </span>
        </div>
      </motion.div>
    </div>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[28px] border border-line bg-surface p-6 shadow-[var(--shadow-lift)] sm:p-8">
      <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[14px] text-muted">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
