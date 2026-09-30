"use client";

import * as React from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import { startCheckoutAction } from "@/app/actions/checkout";
import { useAction } from "@/hooks/use-action";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field, Input, Textarea } from "../ui/input";
import { ErrorPanel } from "../shared/error-panel";
import { StickyActions } from "../shared/sticky-actions";
import { Stepper } from "./stepper";

function localInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StartCheckoutForm({ defaultDays, itemId, itemLabel }: { defaultDays: number; itemId?: string; itemLabel?: string }) {
  const [eventName, setEventName] = React.useState("");
  const [due, setDue] = React.useState(() => {
    const d = new Date(Date.now() + defaultDays * 86400_000);
    d.setHours(17, 0, 0, 0);
    return localInputValue(d);
  });
  const [notes, setNotes] = React.useState("");
  const action = useAction(startCheckoutAction, { refresh: false });
  const presets = ["Field Course", "Training Session", "Event Support", "Site Work"];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        action.run({ eventName, dueAt: due ? new Date(due).toISOString() : null, notes, itemId: itemId ?? null });
      }}
      className="pb-20 lg:pb-0"
    >
      <Stepper current={1} reached={1} />
      <ErrorPanel error={action.error} className="mb-4" />
      {itemLabel && (
        <p className="mb-4 rounded-2xl bg-brand/[0.08] px-4 py-3 text-[14px] text-ink-2">
          <strong className="text-ink">{itemLabel}</strong> will be added to the basket once you choose its storage location.
        </p>
      )}
      <Card className="space-y-5 p-5 md:p-6">
        <div>
          <h2 className="text-[18px] font-bold tracking-tight">Select Event / Session</h2>
          <p className="text-[13.5px] text-muted">What is this equipment going out for?</p>
        </div>
        <Field label="Event or session" htmlFor="event" required>
          <Input id="event" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Chainsaw Safety Level 1" autoFocus maxLength={160} />
        </Field>
        <div className="-mt-2 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setEventName((v) => (v ? v : p))}
              className="h-9 rounded-full border border-line-2 px-3 text-[13px] font-semibold text-ink-2 hover:bg-ink/5"
            >
              {p}
            </button>
          ))}
        </div>
        <Field label="Expected return" htmlFor="due" hint="Sessions become overdue after this time.">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <Input id="due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="pl-10" />
          </div>
        </Field>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" />
        </Field>
      </Card>
      <div className="mt-4">
        <StickyActions>
          <Button type="submit" variant="brand" size="lg" className="w-full lg:w-auto" loading={action.pending} disabled={!eventName.trim()}>
            Continue <ArrowRight />
          </Button>
        </StickyActions>
      </div>
    </form>
  );
}
