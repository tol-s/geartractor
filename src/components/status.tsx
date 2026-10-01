"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Box, Boxes, Droplets, Layers, type LucideIcon } from "lucide-react";
import {
  AVAILABILITY_LABEL,
  CHECKOUT_STATUS_LABEL,
  KIND_LABEL,
  STATUS_LABEL,
  type Availability,
  type CheckoutStatus,
  type InventoryKind,
  type ItemStatus,
} from "@/lib/domain";
import { Badge, type BadgeTone } from "./ui/badge";

export const STATUS_TONE: Record<ItemStatus, BadgeTone> = {
  available: "green",
  needs_inspection: "amber",
  missing: "red",
  rejected: "darkred",
};

export function StatusBadge({ status, className }: { status: ItemStatus; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={status}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="inline-flex"
      >
        <Badge tone={STATUS_TONE[status]} dot className={className}>
          {STATUS_LABEL[status]}
        </Badge>
      </motion.span>
    </AnimatePresence>
  );
}

const AVAIL_TONE: Record<Availability, BadgeTone> = {
  checked_out: "blue",
  reserved: "purple",
  assigned: "slate",
  insufficient_stock: "orange",
};

export function AvailabilityBadge({ value, label }: { value: Availability; label?: string }) {
  return <Badge tone={AVAIL_TONE[value]}>{label ?? AVAILABILITY_LABEL[value]}</Badge>;
}

export const KIND_ICON: Record<InventoryKind, LucideIcon> = {
  component: Box,
  configuration: Layers,
  kit: Boxes,
  consumable: Droplets,
};

const KIND_STYLE: Record<InventoryKind, string> = {
  component: "bg-[#0ea5e9]/12 text-[#0369a1]",
  configuration: "bg-[#8b5cf6]/12 text-[#6d28d9]",
  kit: "bg-brand text-white",
  consumable: "bg-consumable text-white",
};

const KIND_SOLID: Record<InventoryKind, string> = {
  component: "bg-[#0284c7] text-white",
  configuration: "bg-[#7c3aed] text-white",
  kit: "bg-brand text-white",
  consumable: "bg-consumable text-white",
};

export function KindBadge({ kind }: { kind: InventoryKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-semibold ${KIND_STYLE[kind]}`}>
      <Icon className="size-3.5" aria-hidden />
      {KIND_LABEL[kind]}
    </span>
  );
}

export function KindIcon({ kind, size = 40 }: { kind: InventoryKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl ${KIND_SOLID[kind]}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  );
}

const CHECKOUT_TONE: Record<CheckoutStatus, BadgeTone> = {
  draft: "amber",
  active: "green",
  partially_returned: "blue",
  returned: "neutral",
  cancelled: "neutral",
};

export function CheckoutStatusBadge({ status, overdue }: { status: CheckoutStatus; overdue?: boolean }) {
  if (overdue && (status === "active" || status === "partially_returned")) {
    return (
      <Badge tone="red" dot>
        Overdue
      </Badge>
    );
  }
  return (
    <Badge tone={CHECKOUT_TONE[status]} dot>
      {CHECKOUT_STATUS_LABEL[status]}
    </Badge>
  );
}
