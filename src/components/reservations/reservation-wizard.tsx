"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CalendarCheck2, CalendarDays, Check, Clock, LayoutGrid, Loader2, MapPin, ScanLine, Search, Trash2, UserRound } from "lucide-react";
import { INVENTORY_KINDS, KIND_LABEL, KIND_PLURAL, ROLE_LABEL, type InventoryKind, type Role } from "@/lib/domain";
import { cn, formatDateTime, formatQty, plural } from "@/lib/utils";
import { createReservationAction, reservationCandidatesAction, reservationScanAction } from "@/app/actions/reservations";
import { useAction } from "@/hooks/use-action";
import type { ReservationCandidate } from "@/server/reservations";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Field, Input, NativeSelect, Textarea } from "../ui/input";
import { Segmented } from "../ui/controls";
import { ErrorPanel } from "../shared/error-panel";
import { StickyActions } from "../shared/sticky-actions";
import { PageHeader } from "../shared/page-header";
import { KindIcon } from "../status";
import { ScannerOverlay } from "../scan/qr-scanner";

type Selected = ReservationCandidate & { quantity: string };

const AVAIL_TONE = { available: "green", reserved: "purple", unavailable: "red" } as const;
const AVAIL_LABEL = { available: "Available", reserved: "Reserved", unavailable: "Unavailable" } as const;

function todayLocal(offsetDays = 1) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ReservationWizard({
  locations,
  users,
  self,
  canAssign,
}: {
  locations: { id: string; name: string }[];
  users: { id: string; name: string; role: Role }[];
  self: { id: string; name: string };
  canAssign: boolean;
}) {
  const [step, setStep] = React.useState(1);
  const [eventName, setEventName] = React.useState("");
  const [date, setDate] = React.useState(todayLocal(1));
  const [start, setStart] = React.useState("09:00");
  const [end, setEnd] = React.useState("17:00");
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [userId, setUserId] = React.useState(self.id);
  const [notes, setNotes] = React.useState("");
  const [selected, setSelected] = React.useState<Selected[]>([]);
  const [created, setCreated] = React.useState<{ id: string; code: string } | null>(null);

  const startsAt = React.useMemo(() => new Date(`${date}T${start}`), [date, start]);
  const endsAt = React.useMemo(() => new Date(`${date}T${end}`), [date, end]);
  const timeValid = !Number.isNaN(startsAt.getTime()) && endsAt > startsAt && endsAt > new Date();
  const locationName = locations.find((l) => l.id === locationId)?.name;
  const create = useAction(createReservationAction, { success: (d) => `Reservation ${d.code} created`, refresh: false, onSuccess: setCreated });

  if (created) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center">
        <motion.div
          initial={{ scale: 0, rotate: 20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="flex size-24 items-center justify-center rounded-[32px] bg-reserve text-white"
        >
          <CalendarCheck2 className="size-12" />
        </motion.div>
        <h1 className="mt-8 text-[26px] font-bold tracking-tight">Reservation created</h1>
        <p className="mt-2 text-[15px] text-muted">
          {created.code} · {eventName} · {formatDateTime(startsAt)}
        </p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Link href={`/reservations/${created.id}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-5 font-semibold text-white">
            View reservation <ArrowRight className="size-4" />
          </Link>
          <Link href="/dashboard" className="inline-flex h-12 items-center justify-center rounded-2xl border border-line-2 bg-surface px-5 font-semibold">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const steps = ["Details", "Equipment", "Summary"];
  return (
    <div className="mx-auto max-w-5xl pb-24 lg:pb-0">
      <PageHeader title="Reserve Gear" subtitle="Hold equipment for an upcoming event. Double booking is prevented." back={{ href: "/dashboard", label: "Dashboard" }} />
      <ol className="mb-6 grid grid-cols-3 gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-col gap-2">
            <span className="relative h-1.5 overflow-hidden rounded-full bg-ink/10">
              <motion.span className="absolute inset-y-0 left-0 rounded-full bg-reserve" animate={{ width: step > i + 1 ? "100%" : step === i + 1 ? "50%" : "0%" }} />
            </span>
            <span className={cn("text-[12.5px] font-semibold", step === i + 1 ? "text-ink" : "text-muted")}>
              {i + 1}. {s}
            </span>
          </li>
        ))}
      </ol>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
          {step === 1 && (
            <>
              <Card className="space-y-4 p-5 md:p-6">
                <Field label="Event" htmlFor="r-event" required>
                  <Input id="r-event" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Tree Climbing Workshop" autoFocus />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Date" htmlFor="r-date" required>
                    <Input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label="Start time" htmlFor="r-start" required>
                    <Input id="r-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                  </Field>
                  <Field label="End time" htmlFor="r-end" required error={!timeValid && start && end ? "End must be after start and in the future" : undefined}>
                    <Input id="r-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Location" htmlFor="r-loc" required>
                    <NativeSelect
                      id="r-loc"
                      value={locationId}
                      onChange={(e) => {
                        setLocationId(e.target.value);
                        setSelected([]);
                      }}
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {canAssign && (
                    <Field label="Reserved for" htmlFor="r-user">
                      <NativeSelect id="r-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} · {ROLE_LABEL[u.role]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                </div>
                <Field label="Notes" htmlFor="r-notes">
                  <Textarea id="r-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </Card>
              <div className="mt-4">
                <StickyActions>
                  <Button variant="reserve" size="lg" className="w-full lg:w-auto" disabled={!eventName.trim() || !timeValid || !locationId} onClick={() => setStep(2)}>
                    Select equipment <ArrowRight />
                  </Button>
                </StickyActions>
              </div>
            </>
          )}
          {step === 2 && (
            <EquipmentPicker
              window={{ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), locationId }}
              selected={selected}
              setSelected={setSelected}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
              header={`${eventName} · ${formatDateTime(startsAt)} – ${end} · ${locationName}`}
            />
          )}
          {step === 3 && (
            <div className="space-y-4">
              <ErrorPanel error={create.error} />
              <Card className="p-5 md:p-6">
                <h2 className="text-[18px] font-bold tracking-tight">Reservation summary</h2>
                <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                  {[
                    { label: "Event", value: eventName, icon: CalendarDays },
                    { label: "When", value: `${formatDateTime(startsAt)} – ${end}`, icon: Clock },
                    { label: "Location", value: locationName, icon: MapPin },
                    { label: "For", value: users.find((u) => u.id === userId)?.name ?? self.name, icon: UserRound },
                  ].map((d) => (
                    <div key={d.label} className="rounded-2xl bg-surface-2 p-3">
                      <dt className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                        <d.icon className="size-3.5" /> {d.label}
                      </dt>
                      <dd className="mt-1 text-[14px] font-semibold">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card className="divide-y divide-line">
                {selected.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-4">
                    <KindIcon kind={s.kind} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold">
                        <span className="font-mono text-[12px] text-muted">{s.code}</span> {s.name}
                      </p>
                      <p className="text-[12.5px] text-muted">{KIND_LABEL[s.kind]}{s.note ? ` · ${s.note}` : ""}</p>
                    </div>
                    <span className="text-[13px] font-semibold">{s.kind === "consumable" ? formatQty(Number(s.quantity), s.unit as never) : "1"}</span>
                  </div>
                ))}
              </Card>
              <StickyActions>
                <Button variant="secondary" size="lg" className="flex-1 lg:flex-none" onClick={() => setStep(2)}>
                  <ArrowLeft /> Back
                </Button>
                <Button
                  variant="reserve"
                  size="lg"
                  className="flex-[2] lg:flex-none"
                  loading={create.pending}
                  onClick={() =>
                    create.run({
                      eventName,
                      startsAt: startsAt.toISOString(),
                      endsAt: endsAt.toISOString(),
                      locationId,
                      userId,
                      notes,
                      items: selected.map((s) => ({ itemId: s.id, quantity: s.kind === "consumable" ? Number(s.quantity) : 1 })),
                    })
                  }
                >
                  <Check /> Confirm Reservation
                </Button>
              </StickyActions>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function EquipmentPicker({
  window: w,
  selected,
  setSelected,
  onBack,
  onNext,
  header,
}: {
  window: { startsAt: string; endsAt: string; locationId: string };
  selected: Selected[];
  setSelected: React.Dispatch<React.SetStateAction<Selected[]>>;
  onBack: () => void;
  onNext: () => void;
  header: string;
}) {
  const [mode, setMode] = React.useState<"search" | "browse">("browse");
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState<InventoryKind | "all">("all");
  const [loaded, setItems] = React.useState<ReservationCandidate[]>([]);
  const items = mode === "search" && !q.trim() ? [] : loaded;
  const [loading, setLoading] = React.useState(false);
  const [scanOpen, setScanOpen] = React.useState(false);

  React.useEffect(() => {
    if (mode === "search" && !q.trim()) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await reservationCandidatesAction({ q, kind, ...w });
      setLoading(false);
      if (res.ok) setItems(res.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, mode, w.startsAt, w.endsAt, w.locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (c: ReservationCandidate) =>
    setSelected((s) => (s.some((x) => x.id === c.id) ? s.filter((x) => x.id !== c.id) : [...s, { ...c, quantity: c.kind === "consumable" ? "1" : "1" }]));

  const valid = selected.length > 0 && selected.every((s) => s.kind !== "consumable" || Number(s.quantity) > 0);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-4">
        <Card className="p-4 md:p-5">
          <p className="mb-3 text-[13px] font-semibold text-muted">{header}</p>
          <div className="flex flex-wrap gap-2">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "browse", label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-4" /> Browse</span> },
                { value: "search", label: <span className="flex items-center gap-1.5"><Search className="size-4" /> Search</span> },
              ]}
            />
            <Button variant="secondary" onClick={() => setScanOpen(true)}>
              <ScanLine /> Scan
            </Button>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID or name" className="pl-10" aria-label="Search equipment" />
            {loading && <Loader2 className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          {mode === "browse" && (
            <div className="no-scrollbar -mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0">
              <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: "all" as const, label: "All" }, ...INVENTORY_KINDS.map((k) => ({ value: k, label: KIND_PLURAL[k] }))]} />
            </div>
          )}
        </Card>
        <ul className="space-y-2">
          {items.map((c) => {
            const on = selected.some((s) => s.id === c.id);
            return (
              <motion.li layout key={c.id}>
                <button
                  type="button"
                  disabled={c.availability !== "available"}
                  onClick={() => toggle(c)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border-2 bg-surface p-3 text-left transition-all disabled:cursor-not-allowed",
                    on ? "border-reserve bg-reserve/[0.05]" : "border-line hover:border-line-2",
                    c.availability !== "available" && "opacity-70",
                  )}
                >
                  <KindIcon kind={c.kind} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">
                      <span className="font-mono text-[12px] text-muted">{c.code}</span> {c.name}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">
                      {KIND_LABEL[c.kind]}
                      {c.freeQuantity !== null ? ` · ${formatQty(c.freeQuantity, c.unit as never)} free` : ""}
                      {c.note ? ` · ${c.note}` : ""}
                    </span>
                  </span>
                  <Badge tone={AVAIL_TONE[c.availability]} dot>
                    {AVAIL_LABEL[c.availability]}
                  </Badge>
                  {on && (
                    <span className="flex size-6 items-center justify-center rounded-full bg-reserve text-white">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
              </motion.li>
            );
          })}
          {!loading && items.length === 0 && (
            <li className="py-10 text-center text-[14px] text-muted">{mode === "search" && !q ? "Type to search equipment." : "No matching equipment."}</li>
          )}
        </ul>
      </div>
      <div>
        <div className="lg:sticky lg:top-[96px]">
          <Card className="p-5">
            <h3 className="mb-2 text-[15px] font-bold">Selected ({selected.length})</h3>
            {selected.length === 0 ? (
              <p className="py-4 text-[13.5px] text-muted">Select available equipment.</p>
            ) : (
              <ul className="divide-y divide-line">
                {selected.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[11.5px] text-muted">{s.code}</span>
                      <span className="block truncate text-[13.5px] font-semibold">{s.name}</span>
                    </span>
                    {s.kind === "consumable" && (
                      <Input
                        inputMode="decimal"
                        value={s.quantity}
                        onChange={(e) => setSelected((all) => all.map((x) => (x.id === s.id ? { ...x, quantity: e.target.value } : x)))}
                        className="h-9 w-20"
                        aria-label={`Quantity of ${s.name}`}
                      />
                    )}
                    <button onClick={() => toggle(s)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-missing/10 hover:text-missing" aria-label={`Remove ${s.code}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="mt-4">
            <StickyActions>
              <Button variant="secondary" size="lg" className="flex-1 lg:flex-none" onClick={onBack}>
                <ArrowLeft /> Back
              </Button>
              <Button variant="reserve" size="lg" className="flex-[2] lg:flex-1" disabled={!valid} onClick={onNext}>
                Review {plural(selected.length, "item")} <ArrowRight />
              </Button>
            </StickyActions>
          </div>
        </div>
      </div>
      <ScannerOverlay
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title="Scan to reserve"
        onScan={async (text) => {
          const r = await reservationScanAction(text, w);
          if (!r.ok) return { ok: false, message: r.error.message };
          if (r.data.availability !== "available") return { ok: false, message: `${r.data.code}: ${r.data.note ?? AVAIL_LABEL[r.data.availability]}` };
          if (selected.some((s) => s.id === r.data.id)) return { ok: true, message: `${r.data.code} already selected` };
          setSelected((s) => [...s, { ...r.data, quantity: "1" }]);
          return { ok: true, message: `${r.data.code} selected` };
        }}
      />
    </div>
  );
}
