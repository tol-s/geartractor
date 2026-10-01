"use client";

import * as React from "react";
import Link from "next/link";
import { PackagePlus, SlidersHorizontal } from "lucide-react";
import type { InventoryDetail } from "@/server/inventory";
import { KIND_LABEL } from "@/lib/domain";
import { cn, formatDateTime, formatQty } from "@/lib/utils";
import { stockChangeAction } from "@/app/actions/inventory";
import { useAction } from "@/hooks/use-action";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Segmented } from "../ui/controls";

const MOVEMENT_LABEL: Record<string, string> = {
  receive: "Received",
  adjustment: "Adjustment",
  allocate: "Allocated",
  release: "Released",
  issue: "Issued",
  return_unused: "Unused return",
  consumed: "Consumed",
  loss: "Loss",
};

export function StockPanel({
  detail,
  movements,
  canManage,
}: {
  detail: InventoryDetail;
  movements: { id: string; type: string; quantity: number; totalAfter: number; note: string | null; createdAt: Date; userName: string | null }[];
  canManage: boolean;
}) {
  const s = detail.stock;
  const unit = detail.item.quantityUnit;
  const [open, setOpen] = React.useState(false);
  if (!s) return null;
  const unallocated = s.totalQuantity - s.allocatedQuantity - s.issuedQuantity;
  const low = detail.item.reorderThreshold !== null && unallocated < (detail.item.reorderThreshold ?? 0);
  const stats = [
    { label: "Total Remaining", value: s.totalQuantity, strong: true },
    { label: "Unallocated", value: unallocated, strong: true, warn: low },
    { label: "Allocated", value: s.allocatedQuantity },
    { label: "Issued", value: s.issuedQuantity },
    { label: "Unused Return", value: s.unusedReturnedTotal },
    { label: "Consumed", value: s.consumedTotal },
    { label: "Loss", value: s.lossTotal },
    { label: "Adjustments", value: s.adjustmentsTotal },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold">Stock</h2>
          <p className="text-[13px] text-muted">
            Unit: {unit}. Reorder threshold: {detail.item.reorderThreshold !== null ? formatQty(detail.item.reorderThreshold, unit) : "not set"}.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <PackagePlus /> Receive / Adjust
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((st) => (
          <Card key={st.label} className={cn("p-4", st.warn && "border-consumable/40 bg-consumable/[0.05]")}>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{st.label}</p>
            <p className={cn("mt-1 tabular", st.strong ? "text-[24px] font-bold" : "text-[20px] font-semibold text-ink-2", st.warn && "text-[#c2410c]")}>
              {formatQty(st.value)}
              <span className="ml-1 text-[13px] font-medium text-muted">{unit}</span>
            </p>
          </Card>
        ))}
      </div>
      {detail.allocatedTo.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 text-[14px] font-bold">Allocated to</h3>
          <ul className="divide-y divide-line">
            {detail.allocatedTo.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/inventory/${a.parentId}`} className="min-w-0 text-[14px] font-semibold hover:text-brand">
                  {KIND_LABEL[a.parentKind]} {a.parentCode} <span className="font-normal text-muted">{a.parentName}</span>
                </Link>
                <span className={cn("text-[13px] font-semibold tabular", a.allocated < a.required && "text-[#b45309]")}>
                  {formatQty(a.allocated)} / {formatQty(a.required, unit)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="overflow-hidden">
        <h3 className="px-5 pb-2 pt-4 text-[14px] font-bold">Stock ledger</h3>
        {movements.length === 0 ? (
          <p className="px-5 pb-5 text-[14px] text-muted">No movements yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Movement</th>
                  <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                  <th className="px-3 py-2 text-right font-semibold">Total after</th>
                  <th className="px-5 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-5 py-2.5 text-muted">{formatDateTime(m.createdAt)}</td>
                    <td className="px-3 py-2.5 font-semibold">{MOVEMENT_LABEL[m.type] ?? m.type}</td>
                    <td className="px-3 py-2.5 text-right tabular">{formatQty(m.quantity, unit)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-muted">{formatQty(m.totalAfter)}</td>
                    <td className="px-5 py-2.5 text-ink-2">
                      {m.note}
                      {m.userName && <span className="text-muted"> · {m.userName}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <StockDialog open={open} onOpenChange={setOpen} itemId={detail.item.id} unit={unit ?? "units"} />
    </div>
  );
}

function StockDialog({ open, onOpenChange, itemId, unit }: { open: boolean; onOpenChange: (o: boolean) => void; itemId: string; unit: string }) {
  const [type, setType] = React.useState<"receive" | "adjustment">("receive");
  const [quantity, setQuantity] = React.useState("");
  const [reason, setReason] = React.useState("");
  const action = useAction(stockChangeAction, {
    success: "Stock updated",
    onSuccess: () => {
      onOpenChange(false);
      setQuantity("");
      setReason("");
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Receive or adjust stock"
      description={`Quantities are in ${unit} and are never converted.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={action.pending} disabled={!quantity || !reason.trim()} onClick={() => action.run(itemId, { type, quantity: Number(quantity), reason })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={type}
          onChange={setType}
          className="w-full"
          options={[
            { value: "receive", label: (<span className="flex items-center justify-center gap-1.5"><PackagePlus className="size-4" /> Receive</span>) },
            { value: "adjustment", label: (<span className="flex items-center justify-center gap-1.5"><SlidersHorizontal className="size-4" /> Adjust</span>) },
          ]}
        />
        <Field label={type === "receive" ? `Quantity received (${unit})` : `Adjustment (${unit}, use negative to reduce)`} htmlFor="stock-qty">
          <Input id="stock-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason" htmlFor="stock-reason" required>
          <Input id="stock-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === "receive" ? "e.g. PO-2291 delivery" : "e.g. Stocktake correction"} />
        </Field>
      </div>
    </Dialog>
  );
}
