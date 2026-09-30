"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, Clock, Eye, Flag, MapPin, MoreHorizontal, PackageCheck, UserRound } from "lucide-react";
import type { CheckoutDetail } from "@/server/checkout";
import { CHECKOUT_ITEM_STATUS_LABEL, KIND_LABEL, type CheckoutItemStatus } from "@/lib/domain";
import { cn, formatDateTime, formatQty, plural, timeAgo } from "@/lib/utils";
import { setStatusAction } from "@/app/actions/inventory";
import { useAction } from "@/hooks/use-action";
import { PageHeader } from "../shared/page-header";
import { Card } from "../ui/card";
import { Badge, type BadgeTone } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { CheckoutStatusBadge, KindIcon } from "../status";

const LINE_TONE: Record<CheckoutItemStatus, BadgeTone> = {
  pending: "amber",
  issued: "blue",
  returned: "green",
  missing: "red",
  damaged: "amber",
  exception: "neutral",
};

export function CheckoutDetailView({ detail, canReport }: { detail: CheckoutDetail; canReport: boolean }) {
  const c = detail.checkout;
  const overdue = Boolean(c.dueAt && new Date(c.dueAt) < new Date() && (c.status === "active" || c.status === "partially_returned"));
  const roots = detail.lines.filter((l) => !l.parentId);
  const childrenOf = (id: string) => detail.lines.filter((l) => l.parentId === id);
  const outstanding = detail.lines.filter((l) => l.status === "issued").length;
  const [report, setReport] = React.useState<{ id: string; code: string } | null>(null);

  const renderLine = (l: CheckoutDetail["lines"][number], depth: number): React.ReactNode => {
    const parent = l.parentId ? detail.lines.find((p) => p.id === l.parentId) : null;
    return (
      <React.Fragment key={l.id}>
        <li className="flex items-center gap-3 py-3 pr-3" style={{ paddingLeft: 16 + depth * 24 }}>
          <KindIcon kind={l.kind} size={depth ? 32 : 40} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11.5px] font-semibold text-muted">{l.code}</p>
            <p className="truncate text-[14px] font-semibold">{l.name}</p>
            <p className="text-[12px] text-muted">
              {KIND_LABEL[l.kind]}
              {parent ? ` · in ${parent.code}` : ""}
              {!l.isTracked ? ` · ${formatQty(l.quantity, l.unit)}` : ""}
              {l.returnNote ? ` · ${l.returnNote}` : ""}
            </p>
          </div>
          <Badge tone={LINE_TONE[l.status]} dot>
            {CHECKOUT_ITEM_STATUS_LABEL[l.status]}
          </Badge>
          <Menu>
            <MenuTrigger className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Actions for ${l.code}`}>
              <MoreHorizontal />
            </MenuTrigger>
            <MenuContent>
              <MenuItem asChild>
                <Link href={`/inventory/${l.itemId}`}>
                  <Eye /> View Equipment
                </Link>
              </MenuItem>
              {canReport && (
                <MenuItem onSelect={() => setReport({ id: l.itemId, code: l.code })}>
                  <Flag /> Report Issue
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </li>
        {childrenOf(l.id).map((ch) => renderLine(ch, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        back={{ href: "/checkouts", label: "Checkouts" }}
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-muted">{c.code}</span>
            <CheckoutStatusBadge status={c.status} overdue={overdue} />
          </span>
        }
        title={c.eventName ?? "New checkout"}
        subtitle={c.startedAt ? `Started ${timeAgo(c.startedAt)}` : "Not yet confirmed"}
        actions={
          <>
            {c.status === "draft" && (
              <Link href={`/checkouts/${c.id}/edit`} className={buttonVariants({ variant: "brand" })}>
                Continue Checkout <ArrowRight />
              </Link>
            )}
            {(c.status === "active" || c.status === "partially_returned") && (
              <Link href={`/checkouts/${c.id}/return`} className={buttonVariants({ variant: "checkin" })}>
                <PackageCheck /> Check In
              </Link>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 pb-1 pt-4">
            <h2 className="text-[15px] font-bold">Equipment</h2>
            <span className="text-[13px] text-muted">
              {plural(roots.length, "item")}
              {outstanding > 0 && c.status !== "draft" ? ` · ${outstanding} lines out` : ""}
            </span>
          </div>
          {roots.length === 0 ? (
            <p className="p-5 text-[14px] text-muted">No equipment added yet.</p>
          ) : (
            <ul className="divide-y divide-line">{roots.map((r) => renderLine(r, 0))}</ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <dl className="space-y-4">
              {[
                { label: "Session ID", value: <span className="font-mono">{c.code}</span>, icon: PackageCheck },
                { label: "Event", value: c.eventName, icon: CalendarClock },
                { label: "Trainer/User", value: detail.userName, icon: UserRound },
                { label: "Location", value: detail.locationName, icon: MapPin },
                { label: "Start time", value: c.startedAt ? formatDateTime(c.startedAt) : "Not started", icon: Clock },
                { label: "Expected return", value: c.dueAt ? formatDateTime(c.dueAt) : "-", icon: Clock },
                ...(c.completedAt ? [{ label: "Completed", value: formatDateTime(c.completedAt), icon: Clock }] : []),
              ].map((d) => (
                <div key={d.label} className="flex gap-3">
                  <d.icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0">
                    <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">{d.label}</dt>
                    <dd className={cn("text-[14px] font-medium", d.label === "Expected return" && overdue && "text-missing")}>{d.value ?? "-"}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </Card>
          {detail.reservation && (
            <Link href={`/reservations/${detail.reservation.id}`} className="block rounded-[var(--radius-card)] border border-reserved/25 bg-reserved/[0.06] p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-reserved">From reservation</p>
              <p className="mt-1 text-[14px] font-semibold">
                {detail.reservation.code} · {detail.reservation.eventName}
              </p>
            </Link>
          )}
          {c.notes && (
            <Card className="p-5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-[14px]">{c.notes}</p>
            </Card>
          )}
          <p className="px-1 text-[12.5px] text-muted">Created by {detail.createdByName ?? "Platform admin"}</p>
        </div>
      </div>
      <ReportDialog target={report} onClose={() => setReport(null)} />
    </div>
  );
}

export function ReportDialog({ target, onClose }: { target: { id: string; code: string } | null; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const action = useAction(setStatusAction, {
    success: "Issue reported",
    onSuccess: () => {
      setReason("");
      onClose();
    },
  });
  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(o) => !o && onClose()}
      title={`Report issue with ${target?.code ?? ""}`}
      description="The item will be flagged as Needs Inspection."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!reason.trim()} loading={action.pending} onClick={() => target && action.run(target.id, "needs_inspection", reason)}>
            Report issue
          </Button>
        </>
      }
    >
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Field label="What is the issue?" htmlFor="issue" required>
          <Input id="issue" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </motion.div>
    </Dialog>
  );
}
