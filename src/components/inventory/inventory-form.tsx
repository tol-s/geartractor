"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import {
  EXPIRY_BASIS_LABEL,
  INVENTORY_KINDS,
  ITEM_STATUSES,
  KIND_LABEL,
  LIFESPAN_LABEL,
  LIFESPAN_MODES,
  QUANTITY_UNITS,
  STATUS_LABEL,
  type ItemStatus,
} from "@/lib/domain";
import type { InventoryInput } from "@/lib/validators";
import { computeExpiry } from "@/lib/status-rules";
import { addMonthsIso, cn, formatDate } from "@/lib/utils";
import { createInventoryAction, updateInventoryAction } from "@/app/actions/inventory";
import { useAction } from "@/hooks/use-action";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field, Input, NativeSelect, Textarea } from "../ui/input";
import { Segmented, Switch } from "../ui/controls";
import { ErrorPanel } from "../shared/error-panel";
import { StickyActions } from "../shared/sticky-actions";
import { emptyInventoryValues, type InventoryFormValues } from "@/lib/inventory-form-values";

export type { InventoryFormValues };
import { KindIcon } from "../status";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 md:p-6">
      <div className="mb-4">
        <h2 className="text-[16px] font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

export function InventoryForm({
  mode,
  itemId,
  initial,
  locations,
  knownTags,
  lockedKind,
}: {
  mode: "create" | "edit";
  itemId?: string;
  initial: InventoryFormValues;
  locations: { id: string; name: string }[];
  knownTags: string[];
  lockedKind?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = React.useState<InventoryFormValues>(initial);
  const set = <K extends keyof InventoryFormValues>(k: K, val: InventoryFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const [tagDraft, setTagDraft] = React.useState("");
  const statusChanged = mode === "edit" && v.status !== initial.status;

  const toInput = (): InventoryInput => ({
    ...v,
    expiryBasis: v.expiryBasis || null,
    quantityUnit: v.quantityUnit || null,
    lifespanMonths: v.lifespanMonths || null,
    inspectionIntervalMonths: v.inspectionIntervalMonths || null,
    reorderThreshold: v.reorderThreshold || null,
    initialQuantity: v.initialQuantity || null,
  });

  const create = useAction(createInventoryAction, {
    success: (d) => `${d.code} created`,
    refresh: false,
    onSuccess: (d) => router.push(`/inventory/${d.id}`),
  });
  const update = useAction(updateInventoryAction, {
    success: "Changes saved",
    refresh: false,
    onSuccess: () => {
      router.push(`/inventory/${itemId}`);
      router.refresh();
    },
  });
  const pending = create.pending || update.pending;
  const error = create.error ?? update.error;
  const fe = error?.fieldErrors ?? {};

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "create") create.run(toInput());
    else update.run(itemId!, toInput());
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, "");
    if (!t || v.tags.some((x) => x.toLowerCase() === t.toLowerCase()) || v.tags.length >= 20) return;
    set("tags", [...v.tags, t]);
    setTagDraft("");
  };

  const expiryPreview = computeExpiry({
    lifespanMode: v.lifespanMode,
    lifespanMonths: v.lifespanMonths ? Number(v.lifespanMonths) : null,
    expiryBasis: v.expiryBasis || null,
    manufactureDate: v.manufactureDate || null,
    firstUseDate: v.firstUseDate || null,
    explicitExpiry: v.explicitExpiry || null,
  });
  const nextInspectionPreview =
    v.nextInspectionDate || (v.annualInspectionRequired && v.lastInspectionDate ? addMonthsIso(v.lastInspectionDate, Number(v.inspectionIntervalMonths || 12)) : "");

  const id = (k: string) => `f-${k}`;

  return (
    <form onSubmit={submit} className="space-y-4 pb-20 lg:pb-0" noValidate>
      <ErrorPanel error={error} />

      <Section title="Basic Information">
        {mode === "create" && !lockedKind ? (
          <Field label="Type" className="sm:col-span-2" required>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {INVENTORY_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setV((s) => ({ ...emptyInventoryValues(k, s.locationId), name: s.name, techSpec: s.techSpec, manufacturer: s.manufacturer }))}
                  aria-pressed={v.kind === k}
                  className={cn(
                    "flex min-h-14 items-center gap-2.5 rounded-2xl border-2 px-3 text-left text-[14px] font-semibold transition-all",
                    v.kind === k ? "border-brand bg-brand/[0.06]" : "border-line hover:border-line-2",
                  )}
                >
                  <KindIcon kind={k} size={32} />
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </Field>
        ) : (
          <Field label="Type" className="sm:col-span-2">
            <div className="flex items-center gap-2.5 text-[15px] font-semibold">
              <KindIcon kind={v.kind} size={32} /> {KIND_LABEL[v.kind]}
            </div>
          </Field>
        )}
        <Field label="Name" htmlFor={id("name")} required error={fe.name}>
          <Input id={id("name")} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Harness 5" aria-invalid={!!fe.name} />
        </Field>
        <Field label="Serial Number" htmlFor={id("serial")}>
          <Input id={id("serial")} value={v.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} />
        </Field>
        <Field label="Tech Spec" htmlFor={id("spec")} hint="Model, standard or specification">
          <Input id={id("spec")} value={v.techSpec} onChange={(e) => set("techSpec", e.target.value)} placeholder="e.g. Petzl Avao Bod Fast, EN 361" />
        </Field>
        <Field label="Manufacturer" htmlFor={id("mfr")}>
          <Input id={id("mfr")} value={v.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
        </Field>
        {(v.kind === "configuration" || v.kind === "kit") && (
          <Field label="Purpose" htmlFor={id("purpose")} className="sm:col-span-2">
            <Input id={id("purpose")} value={v.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="What is this assembly used for?" />
          </Field>
        )}
      </Section>

      <Section title="Location & Status" description="Assembly contents always move with their parent.">
        <Field label="Storage Location" htmlFor={id("loc")} required error={fe.locationId}>
          <NativeSelect id={id("loc")} value={v.locationId} onChange={(e) => set("locationId", e.target.value)}>
            <option value="">Select a location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Status" htmlFor={id("status")}>
          <NativeSelect id={id("status")} value={v.status} onChange={(e) => set("status", e.target.value as ItemStatus)}>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {(statusChanged || (mode === "create" && v.status !== "available")) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="sm:col-span-2">
            <Field label="Reason for status" htmlFor={id("reason")} required={statusChanged}>
              <Input id={id("reason")} value={v.statusReason} onChange={(e) => set("statusReason", e.target.value)} placeholder="Recorded in the status history" />
            </Field>
          </motion.div>
        )}
      </Section>

      <Section title="Tags">
        <Field label="Descriptive tags" className="sm:col-span-2" hint={`Inventory type tag "${KIND_LABEL[v.kind]}" is applied automatically.`}>
          <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line-2 bg-surface px-2 py-1.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
            <span className="rounded-lg bg-ink px-2 py-1 text-[12px] font-semibold text-white">{KIND_LABEL[v.kind]}</span>
            {v.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-ink/[0.06] py-1 pl-2 pr-1 text-[12.5px] font-medium">
                {t}
                <button type="button" onClick={() => set("tags", v.tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="rounded p-0.5 hover:bg-ink/10">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            <input
              list="known-tags"
              value={tagDraft}
              onChange={(e) => {
                if (e.target.value.endsWith(",")) addTag(e.target.value);
                else setTagDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagDraft);
                } else if (e.key === "Backspace" && !tagDraft && v.tags.length) {
                  set("tags", v.tags.slice(0, -1));
                }
              }}
              onBlur={() => tagDraft && addTag(tagDraft)}
              placeholder="Add a tag and press Enter"
              aria-label="Add tag"
              className="h-8 min-w-[140px] flex-1 bg-transparent px-1 text-[14px] outline-none"
            />
            <datalist id="known-tags">
              {knownTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </Field>
      </Section>

      <Section title="Manufacture & Lifespan" description="The earlier applicable expiry wins. Missing expiry information blocks checkout.">
        <Field label="Manufacture Date" htmlFor={id("mfd")} error={fe.manufactureDate}>
          <Input id={id("mfd")} type="date" value={v.manufactureDate} onChange={(e) => set("manufactureDate", e.target.value)} />
        </Field>
        <Field label="First Use Date" htmlFor={id("fud")} error={fe.firstUseDate} hint="Recorded automatically on first checkout if empty.">
          <Input id={id("fud")} type="date" value={v.firstUseDate} onChange={(e) => set("firstUseDate", e.target.value)} />
        </Field>
        <Field label="Life Span" className="sm:col-span-2">
          <Segmented
            value={v.lifespanMode}
            onChange={(m) => set("lifespanMode", m)}
            options={LIFESPAN_MODES.map((m) => ({ value: m, label: LIFESPAN_LABEL[m] }))}
            className="w-full sm:w-auto"
          />
        </Field>
        {v.lifespanMode === "finite" && (
          <>
            <Field label="Life span (months)" htmlFor={id("life")} required error={fe.lifespanMonths}>
              <Input id={id("life")} inputMode="numeric" value={v.lifespanMonths} onChange={(e) => set("lifespanMonths", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 120" />
            </Field>
            <Field label="Expiry Basis" htmlFor={id("basis")} required error={fe.expiryBasis}>
              <NativeSelect id={id("basis")} value={v.expiryBasis} onChange={(e) => set("expiryBasis", e.target.value as InventoryFormValues["expiryBasis"])}>
                <option value="">Select basis</option>
                {Object.entries(EXPIRY_BASIS_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        )}
        {v.lifespanMode !== "unlimited" && (
          <Field
            label={v.lifespanMode === "explicit" ? "Expiry" : "Explicit expiry (optional)"}
            htmlFor={id("exp")}
            required={v.lifespanMode === "explicit"}
            error={fe.explicitExpiry}
          >
            <Input id={id("exp")} type="date" value={v.explicitExpiry} onChange={(e) => set("explicitExpiry", e.target.value)} />
          </Field>
        )}
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 sm:col-span-2">
          <span className="text-[13px] font-semibold text-muted">Expiry</span>
          <span
            className={cn(
              "text-[14px] font-semibold",
              expiryPreview.missingInfo ? "text-missing" : expiryPreview.pendingInspection ? "text-ink-2" : "text-ink",
            )}
          >
            {expiryPreview.pendingInspection
              ? "Pending Inspection"
              : expiryPreview.missingInfo
                ? "Expiry information missing (checkout blocked)"
                : formatDate(expiryPreview.expiry)}
          </span>
        </div>
      </Section>

      <Section title="Inspection & Use">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-line px-4 py-3 sm:col-span-2">
          <div>
            <p className="text-[14px] font-semibold">Annual Inspection Required</p>
            <p className="text-[13px] text-muted">Overdue inspections set the status to Needs Inspection.</p>
          </div>
          <Switch checked={v.annualInspectionRequired} onCheckedChange={(c) => set("annualInspectionRequired", c)} aria-label="Annual Inspection Required" />
        </div>
        {v.annualInspectionRequired && (
          <Field label="Inspection interval (months)" htmlFor={id("interval")}>
            <Input id={id("interval")} inputMode="numeric" value={v.inspectionIntervalMonths} onChange={(e) => set("inspectionIntervalMonths", e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        <Field label="Last Inspection" htmlFor={id("li")}>
          <Input id={id("li")} type="date" value={v.lastInspectionDate} onChange={(e) => set("lastInspectionDate", e.target.value)} />
        </Field>
        <Field label="Next Inspection" htmlFor={id("ni")} hint={!v.nextInspectionDate && nextInspectionPreview ? `Will be set to ${formatDate(nextInspectionPreview)}` : undefined}>
          <Input id={id("ni")} type="date" value={v.nextInspectionDate} onChange={(e) => set("nextInspectionDate", e.target.value)} />
        </Field>
        <Field label="Last Use Date" htmlFor={id("lu")}>
          <Input id={id("lu")} type="date" value={v.lastUseDate} onChange={(e) => set("lastUseDate", e.target.value)} />
        </Field>
      </Section>

      {v.kind === "consumable" && (
        <Section title="Quantity" description="Units are never converted automatically.">
          <Field label="Quantity Unit" htmlFor={id("unit")} required error={fe.quantityUnit}>
            <NativeSelect id={id("unit")} value={v.quantityUnit} disabled={mode === "edit"} onChange={(e) => set("quantityUnit", e.target.value as InventoryFormValues["quantityUnit"])}>
              {QUANTITY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Reorder Threshold" htmlFor={id("thr")} error={fe.reorderThreshold}>
            <Input id={id("thr")} inputMode="decimal" value={v.reorderThreshold} onChange={(e) => set("reorderThreshold", e.target.value)} />
          </Field>
          {mode === "create" && (
            <Field label="Opening quantity" htmlFor={id("qty")} error={fe.initialQuantity} hint="Later changes are recorded as receipts or adjustments.">
              <Input id={id("qty")} inputMode="decimal" value={v.initialQuantity} onChange={(e) => set("initialQuantity", e.target.value)} />
            </Field>
          )}
        </Section>
      )}

      <Section title="Technical Details" description="Attachments (JPG/PDF) can be added after saving.">
        <Field label="Technical Details" htmlFor={id("tech")} className="sm:col-span-2">
          <Textarea id={id("tech")} value={v.technicalDetails} onChange={(e) => set("technicalDetails", e.target.value)} rows={4} />
        </Field>
        <Field label="Notes" htmlFor={id("notes")} className="sm:col-span-2">
          <Textarea id={id("notes")} value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </Field>
      </Section>

      <StickyActions>
        <Button type="button" variant="secondary" size="lg" className="flex-1 lg:flex-none" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" size="lg" className="flex-[2] lg:flex-none" loading={pending}>
          {pending ? "Saving..." : mode === "create" ? `Create ${KIND_LABEL[v.kind]}` : "Save changes"}
        </Button>
      </StickyActions>
    </form>
  );
}
