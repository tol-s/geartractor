"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Ban, Check, Loader2, Plus, RefreshCw, ScanLine, Search, Trash2, X } from "lucide-react";
import type { InventoryDetail } from "@/server/inventory";
import { KIND_LABEL, STATUS_LABEL, type InventoryKind, type ItemStatus } from "@/lib/domain";
import { cn, formatQty } from "@/lib/utils";
import {
  addKitContentAction,
  allocateConsumableAction,
  assignByScanAction,
  assignChildAction,
  assignmentCandidatesAction,
  releaseAllocationAction,
  removeKitContentAction,
  replenishAllocationAction,
  unassignChildAction,
} from "@/app/actions/inventory";
import { useAction } from "@/hooks/use-action";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Dialog, ConfirmDialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { KindIcon, StatusBadge } from "../status";
import { ScannerOverlay } from "../scan/qr-scanner";

type Candidate = {
  id: string;
  code: string;
  name: string;
  kind: InventoryKind;
  status: ItemStatus;
  eligible: boolean;
  reasons: string[];
  unallocated: number | null;
  unit: string | null;
  available: string | null;
};

export function AppliedGearPanel({ detail, canManage }: { detail: InventoryDetail; canManage: boolean }) {
  const item = detail.item;
  const [addOpen, setAddOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<{ id: string; code: string } | null>(null);
  const unassign = useAction(unassignChildAction, { success: "Removed from assembly", onSuccess: () => setRemoving(null) });
  const release = useAction(releaseAllocationAction, { success: "Allocation released" });
  const replenish = useAction(replenishAllocationAction, { success: "Allocation replenished" });
  const locked = Boolean(detail.checkedOutCode);

  const childrenOf = (parentId: string) => detail.descendants.filter((d) => d.parentId === parentId);
  const allocsOf = (parentId: string) => detail.allocations.filter((a) => a.parentId === parentId);

  const renderNode = (parentId: string, depth: number): React.ReactNode => (
    <>
      {childrenOf(parentId).map((d) => (
        <React.Fragment key={d.id}>
          <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 py-3 pr-4" style={{ paddingLeft: 16 + depth * 22 }}>
            {depth > 0 && <span className="h-6 w-3 shrink-0 border-b-2 border-l-2 border-line-2 rounded-bl-md -mt-5" aria-hidden />}
            <KindIcon kind={d.kind} size={34} />
            <Link href={`/inventory/${d.id}`} className="min-w-0 flex-1">
              <span className="block font-mono text-[12px] font-semibold text-muted">{d.code}</span>
              <span className="block truncate text-[14px] font-semibold hover:text-brand">{d.name}</span>
            </Link>
            <StatusBadge status={d.status} />
            {canManage && parentId === item.id && (
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.code}`} disabled={locked} onClick={() => setRemoving({ id: d.id, code: d.code })}>
                <Trash2 />
              </Button>
            )}
          </motion.li>
          {renderNode(d.id, depth + 1)}
        </React.Fragment>
      ))}
      {allocsOf(parentId).map((a) => {
        const short = a.allocated < a.required;
        return (
          <li key={a.id} className="flex items-center gap-3 py-3 pr-4" style={{ paddingLeft: 16 + depth * 22 }}>
            {depth > 0 && <span className="h-6 w-3 shrink-0 border-b-2 border-l-2 border-line-2 rounded-bl-md -mt-5" aria-hidden />}
            <KindIcon kind="consumable" size={34} />
            <Link href={`/inventory/${a.consumableId}`} className="min-w-0 flex-1">
              <span className="block font-mono text-[12px] font-semibold text-muted">{a.code}</span>
              <span className="block truncate text-[14px] font-semibold hover:text-brand">{a.name}</span>
            </Link>
            <span className={cn("text-[13px] font-semibold tabular", short ? "text-[#b45309]" : "text-ink-2")}>
              {formatQty(a.allocated)} / {formatQty(a.required, a.unit)}
            </span>
            {short && <Badge tone="amber">Shortage</Badge>}
            {canManage && parentId === item.id && (
              <div className="flex">
                {short && (
                  <Button variant="ghost" size="icon-sm" aria-label="Replenish allocation" title="Replenish from stock" disabled={locked || replenish.pending} onClick={() => replenish.run(a.id)}>
                    <RefreshCw />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" aria-label={`Release ${a.code}`} disabled={locked || release.pending} onClick={() => release.run(a.id)}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </>
  );

  const empty = detail.descendants.length === 0 && detail.allocations.length === 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold">Applied Gear</h2>
          <p className="text-[13px] text-muted">
            {item.kind === "configuration" ? "Components and consumables in this configuration." : "Components, configurations, kits and consumables in this kit."} Only eligible gear at the same location can be added.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} disabled={locked} variant="brand">
            <Plus /> Add Gear
          </Button>
        )}
      </div>
      {locked && (
        <p className="rounded-xl bg-checked-out/[0.07] px-4 py-3 text-[13.5px] text-ink-2">
          This assembly is checked out on {detail.checkedOutCode}. Contents cannot change until it is checked in.
        </p>
      )}
      {empty ? (
        <Card className="p-8 text-center">
          <p className="text-[15px] font-semibold">No gear applied yet</p>
          <p className="mt-1 text-[14px] text-muted">Add eligible components{item.kind === "kit" ? ", configurations, kits" : ""} and consumables.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">{renderNode(item.id, 0)}</ul>
        </Card>
      )}

      {item.kind === "kit" && <ManualContents detail={detail} canManage={canManage} />}

      <AddGearDialog open={addOpen} onOpenChange={setAddOpen} parentId={item.id} parentCode={item.code} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.code}?`}
        description={`It will become an independent item at the same location. This is recorded in the history of both items.`}
        confirmLabel="Remove"
        tone="danger"
        loading={unassign.pending}
        onConfirm={() => removing && unassign.run(item.id, removing.id)}
      />
    </div>
  );
}

function AddGearDialog({ open, onOpenChange, parentId, parentCode }: { open: boolean; onOpenChange: (o: boolean) => void; parentId: string; parentCode: string }) {
  const [q, setQ] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<Candidate[]>([]);
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [scanOpen, setScanOpen] = React.useState(false);
  const [added, setAdded] = React.useState<Set<string>>(new Set());

  const load = React.useCallback(
    async (query: string) => {
      setLoading(true);
      const res = await assignmentCandidatesAction(parentId, query);
      setLoading(false);
      if (res.ok) setItems(res.data as Candidate[]);
    },
    [parentId],
  );
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, open, load]);

  const assign = useAction(assignChildAction, {
    success: "Gear added",
    onSuccess: () => load(q),
  });
  const allocate = useAction(allocateConsumableAction, { success: "Consumable allocated", onSuccess: () => load(q) });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          if (!o) setAdded(new Set());
        }}
        title={`Add Gear to ${parentCode}`}
        description="Eligible: Available, same location, not assigned elsewhere, not checked out or reserved."
        size="lg"
      >
        <div className="sticky top-0 z-10 -mx-1 flex gap-2 bg-surface px-1 pb-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID or name" className="pl-10" autoFocus aria-label="Search gear" />
          </div>
          <Button variant="secondary" onClick={() => setScanOpen(true)} aria-label="Scan QR">
            <ScanLine /> <span className="hidden sm:inline">Scan</span>
          </Button>
        </div>
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted" aria-label="Loading" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-muted">No matching gear.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.id} className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3", c.eligible ? "border-line" : "border-line bg-surface-2/70")}>
                <KindIcon kind={c.kind} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">
                    <span className="font-mono text-[12px] text-muted">{c.code}</span> {c.name}
                  </p>
                  {c.eligible ? (
                    <p className="text-[12.5px] text-muted">
                      {KIND_LABEL[c.kind]} · {STATUS_LABEL[c.status]}
                      {c.available ? ` · ${c.available} unallocated` : ""}
                    </p>
                  ) : (
                    <p className="flex items-start gap-1 text-[12.5px] text-[#b45309]">
                      <Ban className="mt-0.5 size-3.5 shrink-0" /> {c.reasons.join(" · ")}
                    </p>
                  )}
                </div>
                {c.eligible &&
                  (added.has(c.id) ? (
                    <span className="flex items-center gap-1 text-[13px] font-semibold text-available">
                      <Check className="size-4" /> Added
                    </span>
                  ) : c.kind === "consumable" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        inputMode="decimal"
                        value={qty[c.id] ?? ""}
                        onChange={(e) => setQty((s) => ({ ...s, [c.id]: e.target.value }))}
                        placeholder="Qty"
                        className="h-10 w-20"
                        aria-label={`Quantity of ${c.name}`}
                      />
                      <Button
                        size="sm"
                        disabled={!Number(qty[c.id]) || allocate.pending}
                        onClick={async () => {
                          const r = await allocate.run(parentId, c.id, Number(qty[c.id]));
                          if (r.ok) setAdded((s) => new Set(s).add(c.id));
                        }}
                      >
                        Allocate
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      disabled={assign.pending}
                      onClick={async () => {
                        const r = await assign.run(parentId, c.id);
                        if (r.ok) setAdded((s) => new Set(s).add(c.id));
                      }}
                    >
                      <Plus /> Add
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <ScannerOverlay
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title={`Scan gear into ${parentCode}`}
        onScan={async (text) => {
          const res = await assignByScanAction(parentId, text);
          if (res.ok) {
            toast.success("Gear added", { id: `assign-${res.data.id}` });
            load(q);
            return { ok: true, message: "Added to assembly" };
          }
          return { ok: false, message: res.error.message };
        }}
      />
    </>
  );
}

function ManualContents({ detail, canManage }: { detail: InventoryDetail; canManage: boolean }) {
  const [desc, setDesc] = React.useState("");
  const [qty, setQty] = React.useState("");
  const add = useAction(addKitContentAction, {
    success: "Content added",
    onSuccess: () => {
      setDesc("");
      setQty("");
    },
  });
  const remove = useAction(removeKitContentAction, { success: "Content removed" });
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[16px] font-bold">Manual contents</h2>
        <p className="text-[13px] text-muted">Descriptive only: no stock, QR or inspection history.</p>
      </div>
      <Card className="overflow-hidden">
        {detail.contents.length === 0 ? (
          <p className="p-5 text-[14px] text-muted">No manual contents.</p>
        ) : (
          <ul className="divide-y divide-line">
            {detail.contents.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <span className="size-2 shrink-0 rounded-full bg-ink/25" aria-hidden />
                <span className="min-w-0 flex-1 text-[14px]">{c.description}</span>
                {c.quantity && <span className="text-[13px] font-semibold text-muted">× {c.quantity}</span>}
                {canManage && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.description}`} onClick={() => remove.run(c.id)}>
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form
            className="flex flex-col gap-2 border-t border-line bg-surface-2 p-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (desc.trim()) add.run(detail.item.id, desc, qty || null);
            }}
          >
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Laminated SOP card" aria-label="Content description" className="flex-1" />
            <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" aria-label="Quantity" className="sm:w-24" />
            <Button type="submit" variant="secondary" loading={add.pending} disabled={!desc.trim()}>
              <Plus /> Add
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
