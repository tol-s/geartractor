"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, ClipboardCheck, ShieldCheck } from "lucide-react";
import type { InventoryKind, ItemStatus } from "@/lib/domain";
import type { StatusReason } from "@/db/schema";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { EmptyState } from "../shared/empty-state";
import { LinkTabs, Pagination } from "../shared/url-controls";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/controls";
import { KindIcon, StatusBadge } from "../status";

type Attention = {
  id: string;
  code: string;
  name: string;
  kind: InventoryKind;
  status: ItemStatus;
  reasons: StatusReason[];
  nextInspectionDate: string | null;
  computedExpiry: string | null;
  locationName: string | null;
  assigned: boolean;
};
type History = {
  rows: {
    id: string;
    code: string;
    inspectedOn: string;
    scope: string;
    notes: string | null;
    inspectorName: string | null;
    rootCode: string | null;
    rootName: string | null;
    counts: { pass: number; fail: number; missing: number; exception: number };
  }[];
  total: number;
  page: number;
  pageCount: number;
};

export function InspectionsView({ attention, history, canInspect, tab }: { attention: Attention[]; history: History; canInspect: boolean; tab: "attention" | "history" }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div>
      <PageHeader title="Inspections" subtitle="Keep equipment safe, compliant and in service." />
      <LinkTabs
        param="tab"
        className="mb-5"
        layoutId="insp-tabs"
        tabs={[
          { value: "attention", label: "Needs attention", count: attention.length },
          { value: "history", label: "History", count: history.total },
        ]}
      />
      {tab === "attention" ? (
        attention.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nothing needs attention." description="All equipment is inspected and in date." action={{ label: "View Inventory", href: "/inventory" }} tone="green" />
        ) : (
          <>
            <ul className="space-y-2">
              {attention.map((a) => {
                const due = a.nextInspectionDate && a.status === "available";
                return (
                  <li key={a.id} className={cn("flex items-center gap-3 rounded-[var(--radius-card)] border bg-surface p-3 shadow-[var(--shadow-card)] md:p-4", selected.has(a.id) ? "border-brand" : "border-line")}>
                    {canInspect && <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} aria-label={`Select ${a.code}`} />}
                    <KindIcon kind={a.kind} size={40} />
                    <Link href={`/inventory/${a.id}`} className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold">
                        <span className="font-mono text-[12px] text-muted">{a.code}</span> {a.name}
                      </span>
                      <span className="block truncate text-[12.5px] text-muted">
                        {a.reasons[0]?.label ?? (due ? `Inspection due ${formatDate(a.nextInspectionDate)}` : "")}
                        {a.reasons.length > 1 ? ` · +${a.reasons.length - 1} more` : ""}
                        {a.locationName ? ` · ${a.locationName}` : ""}
                      </span>
                    </Link>
                    {due && !a.reasons.length ? <Badge tone="amber">Due soon</Badge> : <StatusBadge status={a.status} />}
                    {canInspect && (
                      <Link href={`/inspections/new?root=${a.id}`} className="hidden h-9 items-center rounded-lg border border-line-2 px-3 text-[13px] font-semibold hover:bg-surface-2 md:inline-flex">
                        Inspect
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <AnimatePresence>
              {selected.size > 0 && (
                <motion.div
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 80, opacity: 0 }}
                  className="fixed inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink p-3 pl-5 text-white shadow-[var(--shadow-float)] lg:bottom-8"
                >
                  <span className="flex-1 text-[14px] font-semibold">{selected.size} selected</span>
                  <Button variant="brand" onClick={() => router.push(`/inspections/new?items=${Array.from(selected).join(",")}`)}>
                    <ClipboardCheck /> Bulk inspect
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )
      ) : history.rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No inspections recorded yet." action={{ label: "View Inventory", href: "/inventory" }} />
      ) : (
        <>
          <Card className="divide-y divide-line">
            {history.rows.map((r) => (
              <Link key={r.id} href={`/inspections/${r.id}`} className="flex items-center gap-3 p-4 hover:bg-surface-2">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-available/10 text-available">
                  <ClipboardCheck className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">
                    {r.code} · {formatDate(r.inspectedOn)} <span className="font-normal capitalize text-muted">· {r.scope}</span>
                  </span>
                  <span className="block truncate text-[12.5px] text-muted">
                    {r.inspectorName ?? "Platform admin"}
                    {r.rootCode ? ` · ${r.rootCode} ${r.rootName}` : ""}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </span>
                </span>
                <span className="hidden gap-1 sm:flex">
                  {r.counts.pass > 0 && <Badge tone="green">{r.counts.pass} pass</Badge>}
                  {r.counts.fail > 0 && <Badge tone="darkred">{r.counts.fail} fail</Badge>}
                  {r.counts.missing > 0 && <Badge tone="red">{r.counts.missing} missing</Badge>}
                  {r.counts.exception > 0 && <Badge>{r.counts.exception} exception</Badge>}
                </span>
                <ChevronRight className="size-5 text-muted" />
              </Link>
            ))}
          </Card>
          <Pagination page={history.page} pageCount={history.pageCount} total={history.total} label="inspections" />
        </>
      )}
    </div>
  );
}
