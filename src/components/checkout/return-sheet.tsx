"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, Check, PackageCheck, ScanLine } from "lucide-react";
import type { CheckoutDetail } from "@/server/checkout";
import { KIND_LABEL } from "@/lib/domain";
import { cn, formatQty, plural } from "@/lib/utils";
import { findCheckoutByScanAction, processReturnAction } from "@/app/actions/checkout";
import { useAction } from "@/hooks/use-action";
import { PageHeader } from "../shared/page-header";
import { ErrorPanel } from "../shared/error-panel";
import { StickyActions } from "../shared/sticky-actions";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox, Segmented } from "../ui/controls";
import { KindIcon } from "../status";
import { ScannerOverlay } from "../scan/qr-scanner";

type Outcome = "returned" | "missing" | "damaged" | "exception";
type LineState = { outcome: Outcome; note: string; unused: string; consumed: string; lost: string };

export function ReturnSheet({ detail, focusLine }: { detail: CheckoutDetail; focusLine: string | null }) {
  const router = useRouter();
  const c = detail.checkout;
  const issued = detail.lines.filter((l) => l.status === "issued");
  const byId = new Map(detail.lines.map((l) => [l.id, l]));
  // A "group" is an outstanding top-level line with all its outstanding descendants.
  const rootOf = (lineId: string): string => {
    let cur = byId.get(lineId)!;
    while (cur.parentId && byId.get(cur.parentId)?.status === "issued") cur = byId.get(cur.parentId)!;
    return cur.id;
  };
  const groups = new Map<string, typeof issued>();
  for (const l of issued) {
    const r = rootOf(l.id);
    groups.set(r, [...(groups.get(r) ?? []), l]);
  }
  const focusRoot = focusLine && byId.has(focusLine) ? rootOf(focusLine) : null;

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(focusRoot ? [focusRoot] : Array.from(groups.keys())));
  const [state, setState] = React.useState<Record<string, LineState>>(() =>
    Object.fromEntries(issued.map((l) => [l.id, { outcome: "returned", note: "", unused: String(l.quantity), consumed: "0", lost: "0" }])),
  );
  const [done, setDone] = React.useState<{ done: boolean; processed: number } | null>(null);
  const [scanOpen, setScanOpen] = React.useState(false);
  const patch = (id: string, p: Partial<LineState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...p } }));

  const submit = useAction(processReturnAction, {
    refresh: false,
    success: (r) => (r.done ? "Equipment returned" : `${plural(r.processed, "line")} checked in`),
    onSuccess: (r) => setDone({ done: r.done, processed: r.processed }),
  });

  const send = () => {
    const lines = Array.from(selected).flatMap((root) =>
      (groups.get(root) ?? []).map((l) => {
        const s = state[l.id];
        return l.isTracked
          ? { checkoutItemId: l.id, outcome: s.outcome, note: s.note || null }
          : { checkoutItemId: l.id, outcome: "returned" as const, note: s.note || null, unused: Number(s.unused || 0), consumed: Number(s.consumed || 0), lost: Number(s.lost || 0) };
      }),
    );
    submit.run(c.id, lines);
  };

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="flex size-24 items-center justify-center rounded-[32px] bg-checkin text-white shadow-[0_20px_40px_-12px_var(--brand-3)]"
        >
          <PackageCheck className="size-12" />
        </motion.div>
        <h1 className="mt-8 text-[26px] font-bold tracking-tight">{done.done ? "Equipment returned" : "Partial return saved"}</h1>
        <p className="mt-2 text-[15px] text-muted">
          {c.code} · {plural(done.processed, "line")} processed. {done.done ? "The session is complete." : "Remaining equipment stays checked out."}
        </p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Link href={`/checkouts/${c.id}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-5 font-semibold text-white">
            View session <ArrowRight className="size-4" />
          </Link>
          <Link href="/check-in" className="inline-flex h-12 items-center justify-center rounded-2xl border border-line-2 bg-surface px-5 font-semibold">
            Check in more
          </Link>
        </div>
      </div>
    );
  }

  const selectedLines = Array.from(selected).reduce((n, r) => n + (groups.get(r)?.length ?? 0), 0);
  return (
    <div className="mx-auto max-w-4xl pb-24 lg:pb-0">
      <PageHeader
        back={{ href: `/checkouts/${c.id}`, label: c.code }}
        title="Check In Gear"
        subtitle={`${c.eventName} · ${detail.locationName}`}
        actions={
          <Button variant="secondary" onClick={() => setScanOpen(true)}>
            <ScanLine /> Scan to select
          </Button>
        }
      />
      <ErrorPanel error={submit.error} className="mb-4" />
      <p className="mb-3 text-[13.5px] text-muted">
        Expected equipment. Untick anything that is not coming back now: it stays checked out (partial return).
      </p>
      <div className="space-y-3">
        {Array.from(groups.entries()).map(([root, lines]) => {
          const rootLine = byId.get(root)!;
          const on = selected.has(root);
          return (
            <Card key={root} className={cn("overflow-hidden transition-opacity", !on && "opacity-60", focusRoot === root && "ring-2 ring-checkin")}>
              <label className="flex cursor-pointer items-center gap-3 border-b border-line bg-surface-2 px-4 py-3">
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (v) n.add(root);
                      else n.delete(root);
                      return n;
                    })
                  }
                  aria-label={`Return ${rootLine.code}`}
                />
                <span className="min-w-0 flex-1 text-[14px] font-semibold">
                  {rootLine.code} {rootLine.name}
                  {lines.length > 1 && <span className="ml-1 font-normal text-muted">· {plural(lines.length, "line")}</span>}
                </span>
                {on && (
                  <button
                    type="button"
                    className="text-[12.5px] font-semibold text-brand hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      lines.forEach((l) => patch(l.id, { outcome: "returned", unused: String(l.quantity), consumed: "0", lost: "0" }));
                    }}
                  >
                    All returned
                  </button>
                )}
              </label>
              {on && (
                <ul className="divide-y divide-line">
                  {lines.map((l) => {
                    const depth = (() => {
                      let d = 0;
                      let cur = l;
                      while (cur.parentId && cur.id !== root) {
                        d++;
                        cur = byId.get(cur.parentId)!;
                      }
                      return d;
                    })();
                    const s = state[l.id];
                    const sum = Number(s.unused || 0) + Number(s.consumed || 0) + Number(s.lost || 0);
                    const mismatch = !l.isTracked && Math.abs(sum - l.quantity) > 0.0005;
                    return (
                      <li key={l.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center" style={{ paddingLeft: 16 + depth * 20 }}>
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <KindIcon kind={l.kind} size={36} />
                          <div className="min-w-0">
                            <p className="font-mono text-[11.5px] font-semibold text-muted">{l.code}</p>
                            <p className="truncate text-[14px] font-semibold">{l.name}</p>
                            <p className="text-[12px] text-muted">
                              {KIND_LABEL[l.kind]}
                              {!l.isTracked && ` · ${formatQty(l.quantity, l.unit)} issued`}
                            </p>
                          </div>
                        </div>
                        {l.isTracked ? (
                          <div className="flex flex-col gap-2 md:w-[380px]">
                            <Segmented
                              size="sm"
                              value={s.outcome}
                              onChange={(o) => patch(l.id, { outcome: o })}
                              className="w-full"
                              options={[
                                { value: "returned", label: "Returned" },
                                { value: "missing", label: "Missing" },
                                { value: "damaged", label: "Damaged" },
                                { value: "exception", label: "Exception" },
                              ]}
                            />
                            {s.outcome !== "returned" && (
                              <Input value={s.note} onChange={(e) => patch(l.id, { note: e.target.value })} placeholder="Add a note" className="h-10" aria-label={`Note for ${l.code}`} />
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2 md:w-[380px]">
                            {(["unused", "consumed", "lost"] as const).map((k) => (
                              <label key={k} className="flex flex-col gap-1">
                                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{k === "lost" ? "Loss" : k === "unused" ? "Unused" : "Consumed"}</span>
                                <Input inputMode="decimal" value={s[k]} onChange={(e) => patch(l.id, { [k]: e.target.value })} className={cn("h-10", mismatch && "border-missing")} />
                              </label>
                            ))}
                            {mismatch && <p className="col-span-3 text-[12px] font-medium text-missing">Must add up to {formatQty(l.quantity, l.unit)}</p>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      <div className="mt-4">
        <StickyActions>
          <Button variant="checkin" size="lg" className="w-full lg:w-auto" loading={submit.pending} disabled={!selected.size} onClick={send}>
            <Check /> {submit.pending ? "Saving..." : `Check in ${plural(selectedLines, "line")}`}
          </Button>
        </StickyActions>
      </div>
      <ScannerOverlay
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title="Scan returned equipment"
        onScan={async (text) => {
          const r = await findCheckoutByScanAction(text);
          if (!r.ok) return { ok: false, message: r.error.message };
          if (r.data.checkoutId !== c.id) {
            toast.info("Belongs to another session", { description: "Opening that session's check-in." });
            router.push(`/checkouts/${r.data.checkoutId}/return?line=${r.data.lineId}`);
            return { ok: true, message: "Opening session" };
          }
          const root = rootOf(r.data.lineId);
          setSelected((s) => new Set(s).add(root));
          return { ok: true, message: `${byId.get(root)?.code} selected` };
        }}
      />
    </div>
  );
}
