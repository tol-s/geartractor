"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Flag,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Printer,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { InventoryDetail } from "@/server/inventory";
import type { AuditRow } from "@/server/audit-queries";
import {
  EXPIRY_BASIS_LABEL,
  INSPECTION_OUTCOME_LABEL,
  ITEM_STATUSES,
  KIND_LABEL,
  LIFESPAN_LABEL,
  STATUS_LABEL,
  type ItemStatus,
} from "@/lib/domain";
import { cn, formatDate, formatDateTime, formatQty } from "@/lib/utils";
import { setStatusAction, archiveInventoryAction, restoreInventoryAction } from "@/app/actions/inventory";
import { useAction } from "@/hooks/use-action";
import { Card, DefinitionList } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, NativeSelect } from "../ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { AvailabilityBadge, KindBadge, KindIcon, StatusBadge } from "../status";
import { AppliedGearPanel } from "./applied-gear";
import { StockPanel } from "./stock-panel";
import { HistoryPanel } from "./history-panel";
import { AttachmentsPanel } from "./attachments-panel";
import { QrPanel } from "./qr-panel";

export type ItemDetailData = {
  detail: InventoryDetail;
  inspections: {
    id: string;
    inspectionId: string;
    code: string;
    inspectedOn: string;
    outcome: keyof typeof INSPECTION_OUTCOME_LABEL;
    resultingStatus: ItemStatus;
    nextInspectionDate: string | null;
    notes: string | null;
    inspectorName: string | null;
  }[];
  statusHistory: {
    id: string;
    previousStatus: ItemStatus | null;
    newStatus: ItemStatus;
    reason: string | null;
    source: string;
    createdAt: Date;
    userName: string | null;
  }[];
  audit: AuditRow[];
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number; createdAt: Date; uploadedByName: string | null }[];
  movements: { id: string; type: string; quantity: number; totalAfter: number; note: string | null; createdAt: Date; userName: string | null }[];
  upcoming: { id: string; code: string; eventName: string; startsAt: Date; endsAt: Date; quantity: number }[];
  checkout: { id: string; code: string; event_name: string } | null | undefined;
};

export type DetailPerms = { manage: boolean; inspect: boolean; report: boolean; attachments: boolean; checkout: boolean };

export function ItemDetailView({
  data,
  qr,
  tab,
  perms,
}: {
  data: ItemDetailData;
  qr: { svg: string; url: string } | null;
  tab: string;
  perms: DetailPerms;
}) {
  const { detail } = data;
  const item = detail.item;
  const isAssembly = item.kind === "configuration" || item.kind === "kit";
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tabs = [
    { value: "overview", label: "Overview" },
    ...(isAssembly ? [{ value: "gear", label: "Applied Gear", count: detail.descendants.length + detail.allocations.length }] : []),
    ...(item.kind === "consumable" ? [{ value: "stock", label: "Stock" }] : []),
    { value: "inspections", label: "Inspections", count: data.inspections.length },
    { value: "history", label: "History" },
    { value: "attachments", label: "Attachments", count: data.attachments.length },
    { value: "qr", label: "QR" },
  ];
  const active = tabs.some((t) => t.value === tab) ? tab : "overview";
  const setTab = (t: string) => {
    const next = new URLSearchParams(params.toString());
    if (t === "overview") next.delete("tab");
    else next.set("tab", t);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  const [statusOpen, setStatusOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const restore = useAction(restoreInventoryAction, { success: "Item restored" });
  const path = [...detail.ancestors].reverse();

  return (
    <div>
      {/* Breadcrumb / parent path */}
      <nav aria-label="Location in hierarchy" className="mb-3 flex flex-wrap items-center gap-1 text-[13px] font-semibold text-muted">
        <Link href={item.kind === "component" ? "/inventory?kind=component" : `/${item.kind === "kit" ? "kits" : item.kind === "configuration" ? "configurations" : "consumables"}`} className="rounded-md px-1 hover:bg-ink/5 hover:text-ink">
          {item.kind === "component" ? "Inventory" : `${KIND_LABEL[item.kind]}s`}
        </Link>
        {path.map((p) => (
          <React.Fragment key={p.id}>
            <ChevronRight className="size-3.5" aria-hidden />
            <Link href={`/inventory/${p.id}`} className="rounded-md px-1 hover:bg-ink/5 hover:text-ink">
              {p.code}
            </Link>
          </React.Fragment>
        ))}
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="px-1 text-ink">{item.code}</span>
      </nav>

      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <KindIcon kind={item.kind} size={56} />
          <div className="min-w-0">
            <p className="font-mono text-[13px] font-semibold text-muted">{item.code}</p>
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] md:text-[30px]">{item.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={item.effectiveStatus} />
              <KindBadge kind={item.kind} />
              {detail.ancestors[0] && <AvailabilityBadge value="assigned" label={`Assigned to ${detail.ancestors[0].code}`} />}
              {detail.checkedOutCode && <AvailabilityBadge value="checked_out" label={`Checked Out · ${detail.checkedOutCode}`} />}
              {detail.reservedUntil && <AvailabilityBadge value="reserved" />}
              {item.kind === "consumable" && (detail.stockUnallocated ?? 0) <= 0 && <AvailabilityBadge value="insufficient_stock" />}
              {item.archivedAt && <Badge tone="dark">Archived</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {perms.checkout && !item.archivedAt && (
            <Link href={`/checkouts/new?item=${item.id}`} className={buttonVariants({ variant: "brand" })}>
              <PackageOpen /> Add to Checkout
            </Link>
          )}
          {perms.inspect && (
            <Link href={`/inspections/new?root=${item.id}`} className={buttonVariants({ variant: "secondary" })}>
              <ClipboardCheck /> Inspect
            </Link>
          )}
          {perms.manage && (
            <Link href={`/inventory/${item.id}/edit`} className={buttonVariants({ variant: "secondary" })}>
              <Pencil /> Edit
            </Link>
          )}
          <Menu>
            <MenuTrigger className={buttonVariants({ variant: "secondary", size: "icon" })} aria-label="More actions">
              <MoreHorizontal />
            </MenuTrigger>
            <MenuContent>
              {perms.report && item.status !== "needs_inspection" && (
                <MenuItem onSelect={() => setReportOpen(true)}>
                  <Flag /> Report Issue
                </MenuItem>
              )}
              {perms.manage && (
                <MenuItem onSelect={() => setStatusOpen(true)}>
                  <ShieldAlert /> Change status
                </MenuItem>
              )}
              <MenuItem asChild>
                <Link href={`/print/labels?ids=${item.id}`} target="_blank">
                  <Printer /> Print QR label
                </Link>
              </MenuItem>
              {perms.manage && (
                <>
                  <MenuSeparator />
                  {item.archivedAt ? (
                    <MenuItem onSelect={() => restore.run(item.id)}>
                      <ArchiveRestore /> Restore
                    </MenuItem>
                  ) : (
                    <MenuItem onSelect={() => setArchiveOpen(true)} className="text-missing data-[highlighted]:text-missing [&_svg]:!text-missing">
                      <Archive /> Archive
                    </MenuItem>
                  )}
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {item.statusReasons.length > 0 && <ReasonsPanel item={item} />}

      <div role="tablist" className="no-scrollbar -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={active === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "relative flex h-12 shrink-0 items-center gap-1.5 px-3 text-[14px] font-semibold transition-colors",
              active === t.value ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {"count" in t && t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-ink/[0.07] px-1.5 text-[11px] tabular">{t.count}</span>
            )}
            {active === t.value && <motion.span layoutId="detail-tab" className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-brand" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {active === "overview" && <Overview data={data} qr={qr} setTab={setTab} />}
          {active === "gear" && <AppliedGearPanel detail={detail} canManage={perms.manage} />}
          {active === "stock" && <StockPanel detail={detail} movements={data.movements} canManage={perms.manage} />}
          {active === "inspections" && <InspectionsPanel data={data} canInspect={perms.inspect} itemId={item.id} />}
          {active === "history" && <HistoryPanel audit={data.audit} statusHistory={data.statusHistory} />}
          {active === "attachments" && <AttachmentsPanel itemId={item.id} attachments={data.attachments} canManage={perms.attachments} />}
          {active === "qr" && <QrPanel qr={qr} item={{ id: item.id, code: item.code, name: item.name }} />}
        </motion.div>
      </AnimatePresence>

      <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} itemId={item.id} current={item.status} />
      <StatusDialog open={reportOpen} onOpenChange={setReportOpen} itemId={item.id} current={item.status} report />
      <ArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} itemId={item.id} code={item.code} />
    </div>
  );
}

function ReasonsPanel({ item }: { item: InventoryDetail["item"] }) {
  const blockerOnly = item.effectiveStatus === "available";
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mb-5 rounded-2xl border p-4",
        blockerOnly || item.effectiveStatus === "needs_inspection" ? "border-inspection/30 bg-inspection/[0.07]" : "border-missing/25 bg-missing/[0.06]",
      )}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className={cn("mt-0.5 size-5 shrink-0", blockerOnly || item.effectiveStatus === "needs_inspection" ? "text-inspection" : "text-missing")} aria-hidden />
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">
            {blockerOnly ? "Checkout blocked" : `${item.code} ${STATUS_LABEL[item.effectiveStatus]}`}
          </p>
          <p className="text-[13px] text-ink-2">Reasons:</p>
          <ul className="mt-1 space-y-1 text-[13.5px] text-ink-2">
            {item.statusReasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden>•</span>
                <span className="min-w-0">
                  {r.sourceItemId && r.sourceItemId !== item.id ? (
                    <Link href={`/inventory/${r.sourceItemId}`} className="underline-offset-2 hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                  {r.path && r.path.length > 1 && <span className="ml-1 text-muted">({r.path.join(" › ")})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}

function Overview({ data, qr, setTab }: { data: ItemDetailData; qr: { svg: string; url: string } | null; setTab: (t: string) => void }) {
  const { detail } = data;
  const i = detail.item;
  const expiry = i.lifespanMode === "unlimited" ? "Pending Inspection" : i.computedExpiry ? formatDate(i.computedExpiry) : "Missing";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">Basic Information</h2>
          <DefinitionList
            items={[
              { label: "ID", value: <span className="font-mono">{i.code}</span> },
              { label: "Serial Number", value: i.serialNumber },
              { label: "Tech Spec", value: i.techSpec },
              { label: "Name", value: i.name },
              { label: "Manufacturer", value: i.manufacturer },
              { label: "Type", value: KIND_LABEL[i.kind] },
              ...(detail.purpose ? [{ label: "Purpose", value: detail.purpose }] : []),
            ]}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">Location & Status</h2>
          <DefinitionList
            items={[
              { label: "Storage Location", value: detail.locationName },
              { label: "Status", value: <StatusBadge status={i.effectiveStatus} /> },
              {
                label: "Assignment",
                value: detail.ancestors.length ? (
                  <span className="flex flex-wrap items-center gap-1">
                    Assigned to{" "}
                    {[...detail.ancestors].map((a, idx) => (
                      <React.Fragment key={a.id}>
                        {idx > 0 && <ChevronRight className="size-3.5 text-muted" />}
                        <Link href={`/inventory/${a.id}`} className="font-semibold text-brand hover:underline">
                          {KIND_LABEL[a.kind]} {a.code}
                        </Link>
                      </React.Fragment>
                    ))}
                  </span>
                ) : (
                  "Unassigned"
                ),
              },
              ...(i.status !== i.effectiveStatus ? [{ label: "Own status", value: STATUS_LABEL[i.status] }] : []),
            ]}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">Tags</h2>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-lg bg-ink px-2 py-1 text-[12px] font-semibold text-white">{KIND_LABEL[i.kind]}</span>
            {detail.tags.map((t) => (
              <Link key={t.id} href={`/inventory?tag=${encodeURIComponent(t.name)}`} className="rounded-lg bg-ink/[0.06] px-2 py-1 text-[12.5px] font-medium hover:bg-ink/10">
                {t.name}
              </Link>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">Manufacture & Lifespan</h2>
          <DefinitionList
            items={[
              { label: "Manufacture Date", value: i.manufactureDate ? formatDate(i.manufactureDate) : null },
              { label: "First Use Date", value: i.firstUseDate ? formatDate(i.firstUseDate) : null },
              { label: "Life Span", value: i.lifespanMode === "finite" ? `${LIFESPAN_LABEL.finite} · ${i.lifespanMonths ?? "?"} months` : LIFESPAN_LABEL[i.lifespanMode] },
              { label: "Expiry Basis", value: i.expiryBasis ? EXPIRY_BASIS_LABEL[i.expiryBasis] : i.lifespanMode === "explicit" ? "Explicit date" : null },
              {
                label: "Expiry",
                value: <span className={cn(expiry === "Missing" && "font-semibold text-missing")}>{expiry === "Missing" ? "Missing (checkout blocked)" : expiry}</span>,
              },
            ]}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">Inspection & Use</h2>
          <DefinitionList
            items={[
              { label: "Annual Inspection Required", value: i.annualInspectionRequired ? `Yes · every ${i.inspectionIntervalMonths} months` : "No" },
              { label: "Last Inspection", value: i.lastInspectionDate ? formatDate(i.lastInspectionDate) : null },
              { label: "Next Inspection", value: i.nextInspectionDate ? formatDate(i.nextInspectionDate) : null },
              { label: "Last Use Date", value: i.lastUseDate ? formatDate(i.lastUseDate) : null },
              {
                label: "Inspection History",
                value: (
                  <button onClick={() => setTab("inspections")} className="font-semibold text-brand hover:underline">
                    {data.inspections.length} record{data.inspections.length === 1 ? "" : "s"}
                  </button>
                ),
              },
            ]}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">Technical Details</h2>
          {i.technicalDetails ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{i.technicalDetails}</p> : <p className="text-[14px] text-muted">No technical details recorded.</p>}
          {i.notes && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-[13.5px] text-ink-2">{i.notes}</p>}
          <button onClick={() => setTab("attachments")} className="mt-3 text-[13px] font-semibold text-brand hover:underline">
            {data.attachments.length} attachment{data.attachments.length === 1 ? "" : "s"}
          </button>
        </Card>
      </div>
      <div className="space-y-4">
        {data.checkout && (
          <Link href={`/checkouts/${data.checkout.id}`} className="block rounded-[var(--radius-card)] border border-checked-out/25 bg-checked-out/[0.06] p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-checked-out">Checked out</p>
            <p className="mt-1 text-[15px] font-bold">{data.checkout.event_name}</p>
            <p className="text-[13px] text-muted">{data.checkout.code}</p>
          </Link>
        )}
        {i.kind === "consumable" && detail.stock && (
          <Card className="p-5">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Unallocated stock</p>
            <p className="mt-1 text-[30px] font-bold tabular">{formatQty(detail.stockUnallocated ?? 0, i.quantityUnit)}</p>
            <p className="text-[13px] text-muted">of {formatQty(detail.stock.totalQuantity, i.quantityUnit)} total remaining</p>
            <button onClick={() => setTab("stock")} className="mt-3 text-[13px] font-semibold text-brand hover:underline">
              View stock ledger
            </button>
          </Card>
        )}
        {data.upcoming.length > 0 && (
          <Card className="p-5">
            <h3 className="mb-3 text-[14px] font-bold">Reservations</h3>
            <ul className="space-y-2">
              {data.upcoming.map((r) => (
                <li key={r.id}>
                  <Link href={`/reservations/${r.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
                    <CalendarClock className="size-5 text-reserved" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{r.eventName}</span>
                      <span className="block text-[12px] text-muted">{formatDateTime(r.startsAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {qr && (
          <Card className="flex items-center gap-4 p-5">
            <div className="size-24 shrink-0 rounded-xl border border-line bg-white p-1 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div className="min-w-0">
              <p className="text-[14px] font-bold">QR code</p>
              <p className="text-[12.5px] text-muted">Stable link to this record</p>
              <button onClick={() => setTab("qr")} className="mt-2 text-[13px] font-semibold text-brand hover:underline">
                Download or print
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function InspectionsPanel({ data, canInspect, itemId }: { data: ItemDetailData; canInspect: boolean; itemId: string }) {
  return (
    <div className="space-y-4">
      {canInspect && (
        <div className="flex justify-end">
          <Link href={`/inspections/new?root=${itemId}`} className={buttonVariants({ variant: "primary" })}>
            <ClipboardCheck /> New inspection
          </Link>
        </div>
      )}
      {data.inspections.length === 0 ? (
        <Card className="p-8 text-center text-[14px] text-muted">No inspection records yet.</Card>
      ) : (
        <Card className="divide-y divide-line">
          {data.inspections.map((r) => (
            <Link key={r.id} href={`/inspections/${r.inspectionId}`} className="flex items-start gap-3 p-4 hover:bg-surface-2">
              <Badge tone={r.outcome === "pass" ? "green" : r.outcome === "exception" ? "neutral" : "red"}>{INSPECTION_OUTCOME_LABEL[r.outcome]}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">
                  {formatDate(r.inspectedOn)} · {r.code}
                </p>
                <p className="text-[13px] text-muted">
                  {r.inspectorName ?? "Platform admin"}
                  {r.nextInspectionDate ? ` · next due ${formatDate(r.nextInspectionDate)}` : ""}
                </p>
                {r.notes && <p className="mt-1 text-[13px] text-ink-2">{r.notes}</p>}
              </div>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

function StatusDialog({
  open,
  onOpenChange,
  itemId,
  current,
  report,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  itemId: string;
  current: ItemStatus;
  report?: boolean;
}) {
  const [status, setStatus] = React.useState<ItemStatus>(report ? "needs_inspection" : current);
  const [reason, setReason] = React.useState("");
  const action = useAction(setStatusAction, {
    success: report ? "Issue reported" : "Status updated",
    onSuccess: () => {
      onOpenChange(false);
      setReason("");
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={report ? "Report an issue" : "Change status"}
      description={report ? "The item will be flagged as Needs Inspection until it is inspected." : "Status changes are recorded in the history with your reason."}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={report ? "brand" : "primary"} loading={action.pending} disabled={!reason.trim()} onClick={() => action.run(itemId, status, reason)}>
            {report ? "Report issue" : "Update status"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!report && (
          <Field label="New status" htmlFor="new-status">
            <NativeSelect id="new-status" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label={report ? "What is the issue?" : "Reason"} htmlFor="status-reason" required>
          <Input id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={report ? "e.g. Frayed webbing near buckle" : "e.g. Found in the Workshop"} autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

function ArchiveDialog({ open, onOpenChange, itemId, code }: { open: boolean; onOpenChange: (o: boolean) => void; itemId: string; code: string }) {
  const [reason, setReason] = React.useState("");
  const action = useAction(archiveInventoryAction, { success: `${code} archived`, onSuccess: () => onOpenChange(false) });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Archive ${code}?`}
      description="Archived items are hidden from inventory and cannot be checked out. History is preserved and the item can be restored."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={action.pending} disabled={!reason.trim()} onClick={() => action.run(itemId, reason)}>
            Archive
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="archive-reason" required>
        <Input id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Retired after end of life" />
      </Field>
    </Dialog>
  );
}
