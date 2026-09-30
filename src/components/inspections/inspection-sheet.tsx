"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import type { InspectionSheetItem } from "@/server/inspections";
import { INSPECTION_OUTCOME_LABEL, STATUS_LABEL, type InspectionOutcome } from "@/lib/domain";
import { addMonthsIso, cn, formatDate } from "@/lib/utils";
import { recordInspectionAction } from "@/app/actions/inspections";
import { useAction } from "@/hooks/use-action";
import { PageHeader } from "../shared/page-header";
import { ErrorPanel } from "../shared/error-panel";
import { StickyActions } from "../shared/sticky-actions";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Field, Input, Textarea } from "../ui/input";
import { Segmented } from "../ui/controls";
import { KindIcon, StatusBadge } from "../status";
import type { InventoryKind } from "@/lib/domain";

type Row = { outcome: InspectionOutcome; notes: string; next: string };

export function InspectionSheet({ sheet, today }: { sheet: { scope: string; rootItemId: string | null; items: InspectionSheetItem[] }; today: string }) {
  const router = useRouter();
  const [date, setDate] = React.useState(today);
  const [notes, setNotes] = React.useState("");
  const [rows, setRows] = React.useState<Record<string, Row>>(() =>
    Object.fromEntries(sheet.items.map((i) => [i.id, { outcome: "pass" as InspectionOutcome, notes: "", next: "" }])),
  );
  const patch = (id: string, p: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  const save = useAction(recordInspectionAction, {
    success: (r) => `Inspection ${r.code} recorded`,
    refresh: false,
    onSuccess: (r) => router.push(`/inspections/${r.id}`),
  });
  const root = sheet.rootItemId ? sheet.items.find((i) => i.id === sheet.rootItemId) : null;
  const title = sheet.scope === "assembly" ? `Inspect ${root?.code} and contents` : sheet.scope === "bulk" ? `Bulk inspection (${sheet.items.length})` : `Inspect ${sheet.items[0].code}`;

  return (
    <div className="mx-auto max-w-4xl pb-24 lg:pb-0">
      <PageHeader title={title} subtitle="Passing updates the next inspection date. It never overrides hard expiry, Missing or Rejected." back={{ href: "/inspections", label: "Inspections" }} />
      <ErrorPanel error={save.error} className="mb-4" />
      <Card className="mb-4 grid gap-4 p-5 sm:grid-cols-[200px_1fr]">
        <Field label="Inspection date" htmlFor="insp-date">
          <Input id="insp-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="insp-notes">
          <Textarea id="insp-notes" rows={1} className="min-h-11" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Overall notes" />
        </Field>
      </Card>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] text-muted">{sheet.items.length} item(s). Use Exception for items not inspected (a note is required).</p>
        <Button variant="ghost" size="sm" onClick={() => sheet.items.forEach((i) => patch(i.id, { outcome: "pass" }))}>
          <CheckCheck /> All pass
        </Button>
      </div>
      <Card className="divide-y divide-line">
        {sheet.items.map((i) => {
          const r = rows[i.id];
          const nextDefault = addMonthsIso(date || today, 12);
          const warnHard = r.outcome === "pass" && (i.baseStatus === "missing" || i.baseStatus === "rejected" || (i.computedExpiry && i.computedExpiry <= today));
          return (
            <div key={i.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-start" style={{ paddingLeft: 16 + i.depth * 22 }}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <KindIcon kind={i.kind as InventoryKind} size={i.depth ? 34 : 40} />
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] font-semibold text-muted">{i.code}</p>
                  <p className="truncate text-[14.5px] font-semibold">{i.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    <StatusBadge status={i.effectiveStatus} />
                    <span>Last: {i.lastInspectionDate ? formatDate(i.lastInspectionDate) : "never"}</span>
                    {i.nextInspectionDate && <span>· Next: {formatDate(i.nextInspectionDate)}</span>}
                  </div>
                  {i.reasons.length > 0 && <p className="mt-1 text-[12.5px] text-[#b45309]">{i.reasons.map((x) => x.label).join(" · ")}</p>}
                  {warnHard && (
                    <p className="mt-1 text-[12.5px] font-medium text-ink-2">
                      Passing keeps it {i.baseStatus === "available" || i.baseStatus === "needs_inspection" ? "restricted (expired)" : STATUS_LABEL[i.baseStatus]}.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 md:w-[400px]">
                <Segmented
                  size="sm"
                  value={r.outcome}
                  onChange={(o) => patch(i.id, { outcome: o })}
                  className="w-full"
                  options={(Object.keys(INSPECTION_OUTCOME_LABEL) as InspectionOutcome[]).map((o) => ({
                    value: o,
                    label: o === "pass" ? "Pass" : o === "fail" ? "Fail" : o === "missing" ? "Missing" : "Exception",
                  }))}
                />
                <div className={cn("grid gap-2", r.outcome === "pass" && "sm:grid-cols-[1fr_150px]")}>
                  <Input
                    value={r.notes}
                    onChange={(e) => patch(i.id, { notes: e.target.value })}
                    placeholder={r.outcome === "exception" ? "Why was it not inspected? (required)" : "Notes"}
                    className={cn("h-10", r.outcome === "exception" && !r.notes.trim() && "border-inspection")}
                    aria-label={`Notes for ${i.code}`}
                  />
                  {r.outcome === "pass" && (
                    <Input type="date" value={r.next || nextDefault} onChange={(e) => patch(i.id, { next: e.target.value })} className="h-10" aria-label={`Next inspection for ${i.code}`} title="Next inspection" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </Card>
      <div className="mt-4">
        <StickyActions>
          <Button
            variant="primary"
            size="lg"
            className="w-full lg:w-auto"
            loading={save.pending}
            onClick={() =>
              save.run({
                rootItemId: sheet.rootItemId,
                inspectedOn: date,
                notes,
                records: sheet.items.map((i) => ({
                  itemId: i.id,
                  outcome: rows[i.id].outcome,
                  notes: rows[i.id].notes || null,
                  nextInspectionDate: rows[i.id].outcome === "pass" ? rows[i.id].next || null : null,
                })),
              })
            }
          >
            Save inspection
          </Button>
        </StickyActions>
      </div>
    </div>
  );
}
