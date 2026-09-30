"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  LayoutGrid,
  Loader2,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  ScanLine,
  Search,
  ShoppingBasket,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { CheckoutDetail } from "@/server/checkout";
import { INVENTORY_KINDS, KIND_LABEL, KIND_PLURAL, ROLE_LABEL, type InventoryKind, type ItemStatus, type Role } from "@/lib/domain";
import { cn, formatDateTime, formatQty, plural } from "@/lib/utils";
import {
  addToBasketAction,
  cancelDraftAction,
  confirmCheckoutAction,
  removeFromBasketAction,
  searchCandidatesAction,
  updateBasketQuantityAction,
  updateCheckoutStepAction,
} from "@/app/actions/checkout";
import { useAction } from "@/hooks/use-action";
import type { ActionError } from "@/server/errors";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field, Input, Textarea } from "../ui/input";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Dialog, ConfirmDialog } from "../ui/dialog";
import { Segmented } from "../ui/controls";
import { ErrorPanel } from "../shared/error-panel";
import { StickyActions } from "../shared/sticky-actions";
import { PageHeader } from "../shared/page-header";
import { KindIcon, StatusBadge } from "../status";
import { ScannerOverlay } from "../scan/qr-scanner";
import { Stepper } from "./stepper";

type Loc = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  stats: { total: number; available: number; checkedOut: number; needsInspection: number; missing: number } | null;
};

type Candidate = {
  id: string;
  code: string;
  name: string;
  kind: InventoryKind;
  status: ItemStatus;
  unit: string | null;
  locationName: string | null;
  techSpec: string | null;
  children: number;
  eligible: boolean;
  flags: string[];
  message: string | null;
  unallocated: number | null;
  inBasket: boolean;
};

export function CheckoutWizard({
  detail,
  initialStep,
  users,
  self,
  canAssign,
  canOverride,
  locations,
  pendingItem,
}: {
  detail: CheckoutDetail;
  initialStep: number;
  users: { id: string; name: string; email: string; role: Role }[];
  self: { id: string; name: string; email: string };
  canAssign: boolean;
  canOverride: boolean;
  locations: Loc[];
  pendingItem: { id: string; code: string; name: string; locationId: string | null } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const c = detail.checkout;
  const [step, setStepState] = React.useState(initialStep);
  const [done, setDone] = React.useState<{ code: string; itemCount: number } | null>(null);
  const setStep = (s: number) => {
    setStepState(s);
    router.replace(`${pathname}?step=${s}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const reached = Math.max(c.currentStep, step);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const cancel = useAction(cancelDraftAction, { success: "Checkout discarded" });

  if (done) return <CheckoutSuccess checkoutId={c.id} code={done.code} itemCount={done.itemCount} />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={step === 5 ? "Review Checkout" : "Start Checkout"}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono font-semibold text-ink-2">{c.code}</span>
            {c.eventName && <span>· {c.eventName}</span>}
          </span>
        }
        back={{ href: "/dashboard", label: "Dashboard" }}
        actions={
          <Button variant="ghost" onClick={() => setCancelOpen(true)} className="text-muted">
            <X /> Discard
          </Button>
        }
      />
      <Stepper current={step} reached={reached} onSelect={setStep} />
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
          {step === 1 && <EventStep detail={detail} onNext={() => setStep(2)} />}
          {step === 2 && <UserStep detail={detail} users={users} self={self} canAssign={canAssign} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <LocationStep detail={detail} locations={locations} preferred={pendingItem?.locationId ?? null} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
          {step === 4 && <EquipmentStep detail={detail} canOverride={canOverride} pendingItem={pendingItem} onBack={() => setStep(3)} onNext={() => setStep(5)} />}
          {step === 5 && <ReviewStep detail={detail} canOverride={canOverride} onBack={() => setStep(4)} onDone={setDone} locations={locations} />}
        </motion.div>
      </AnimatePresence>
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Discard this checkout?"
        description="The basket will be cleared. No equipment has been issued yet."
        confirmLabel="Discard"
        tone="danger"
        loading={cancel.pending}
        onConfirm={() => cancel.run(c.id)}
      />
    </div>
  );
}

function StepCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 md:p-6">
      <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[13.5px] text-muted">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function NavButtons({ onBack, next, nextLabel = "Continue", loading, disabled }: { onBack?: () => void; next: () => void; nextLabel?: string; loading?: boolean; disabled?: boolean }) {
  return (
    <div className="mt-4 pb-20 lg:pb-0">
      <StickyActions>
        {onBack && (
          <Button variant="secondary" size="lg" onClick={onBack} className="flex-1 lg:flex-none">
            <ArrowLeft /> Back
          </Button>
        )}
        <Button variant="brand" size="lg" onClick={next} loading={loading} disabled={disabled} className="flex-[2] lg:flex-none">
          {nextLabel} <ArrowRight />
        </Button>
      </StickyActions>
    </div>
  );
}

/* ---------------- Step 1 ---------------- */

function EventStep({ detail, onNext }: { detail: CheckoutDetail; onNext: () => void }) {
  const c = detail.checkout;
  const [eventName, setEventName] = React.useState(c.eventName ?? "");
  const [notes, setNotes] = React.useState(c.notes ?? "");
  const [due, setDue] = React.useState(() => {
    if (!c.dueAt) return "";
    const d = new Date(c.dueAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const save = useAction(updateCheckoutStepAction, { onSuccess: onNext });
  return (
    <>
      <ErrorPanel error={save.error} className="mb-4" />
      <StepCard title="Select Event / Session" subtitle="What is this equipment going out for?">
        <div className="space-y-4">
          <Field label="Event or session" htmlFor="event" required>
            <Input id="event" value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </Field>
          <Field label="Expected return" htmlFor="due">
            <Input id="due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </StepCard>
      <NavButtons
        next={() => save.run(c.id, { step: 1, eventName, notes, dueAt: due ? new Date(due).toISOString() : null })}
        loading={save.pending}
        disabled={!eventName.trim()}
      />
    </>
  );
}

/* ---------------- Step 2 ---------------- */

function UserStep({
  detail,
  users,
  self,
  canAssign,
  onBack,
  onNext,
}: {
  detail: CheckoutDetail;
  users: { id: string; name: string; email: string; role: Role }[];
  self: { id: string; name: string; email: string };
  canAssign: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const [selected, setSelected] = React.useState(detail.checkout.userId ?? self.id);
  const [q, setQ] = React.useState("");
  const save = useAction(updateCheckoutStepAction, { onSuccess: onNext });
  const list = canAssign ? users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())) : [{ ...self, role: "trainer" as Role }];
  return (
    <>
      <ErrorPanel error={save.error} className="mb-4" />
      <StepCard title="Select Trainer / User" subtitle={canAssign ? "Who is responsible for this equipment?" : "You are checking out equipment for yourself."}>
        {canAssign && users.length > 6 && (
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="pl-10" aria-label="Search people" />
          </div>
        )}
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {list.map((u) => (
            <button
              key={u.id}
              role="radio"
              aria-checked={selected === u.id}
              onClick={() => setSelected(u.id)}
              className={cn(
                "flex min-h-16 items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all",
                selected === u.id ? "border-brand bg-brand/[0.06]" : "border-line hover:border-line-2",
              )}
            >
              <Avatar name={u.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">
                  {u.name}
                  {u.id === self.id && <span className="ml-1.5 text-[12px] font-medium text-muted">(you)</span>}
                </span>
                <span className="block truncate text-[12.5px] text-muted">{canAssign ? ROLE_LABEL[u.role] : u.email}</span>
              </span>
              {selected === u.id && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex size-6 items-center justify-center rounded-full bg-brand text-white">
                  <Check className="size-3.5" strokeWidth={3} />
                </motion.span>
              )}
            </button>
          ))}
        </div>
      </StepCard>
      <NavButtons onBack={onBack} next={() => save.run(detail.checkout.id, { step: 2, userId: selected })} loading={save.pending} />
    </>
  );
}

/* ---------------- Step 3 ---------------- */

function LocationStep({
  detail,
  locations,
  preferred,
  onBack,
  onNext,
}: {
  detail: CheckoutDetail;
  locations: Loc[];
  preferred: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const [selected, setSelected] = React.useState(detail.checkout.locationId ?? preferred ?? "");
  const save = useAction(updateCheckoutStepAction, {
    onSuccess: (r) => {
      if (r.removed.length) toast.warning("Basket updated", { description: `${r.removed.join(", ")} removed: stored at another location.` });
      onNext();
    },
  });
  return (
    <>
      <ErrorPanel error={save.error} className="mb-4" />
      <StepCard title="Select Storage Location" subtitle="Equipment must be issued from its storage location.">
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {locations.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={selected === l.id}
              onClick={() => setSelected(l.id)}
              className={cn(
                "flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all",
                selected === l.id ? "border-brand bg-brand/[0.06]" : "border-line hover:border-line-2",
              )}
            >
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", selected === l.id ? "bg-brand text-white" : "bg-reserve/10 text-reserve")}>
                <MapPin className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{l.name}</span>
                {l.stats && (
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {l.stats.available} available · {l.stats.total} total
                  </span>
                )}
                {preferred === l.id && <Badge tone="brand" className="mt-1.5">Selected item is here</Badge>}
              </span>
            </button>
          ))}
        </div>
      </StepCard>
      <NavButtons onBack={onBack} next={() => save.run(detail.checkout.id, { step: 3, locationId: selected })} loading={save.pending} disabled={!selected} />
    </>
  );
}

/* ---------------- Step 4 ---------------- */

function EquipmentStep({
  detail,
  canOverride,
  pendingItem,
  onBack,
  onNext,
}: {
  detail: CheckoutDetail;
  canOverride: boolean;
  pendingItem: { id: string; code: string; name: string } | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const c = detail.checkout;
  const [mode, setMode] = React.useState<"scan" | "search" | "browse">("search");
  const [scanOpen, setScanOpen] = React.useState(false);
  const [error, setError] = React.useState<ActionError | null>(null);
  const [basketOpen, setBasketOpen] = React.useState(false);
  const addedPending = React.useRef(false);
  const router = useRouter();
  const roots = detail.lines.filter((l) => !l.parentId);

  const add = useAction(addToBasketAction, {
    toastErrors: false,
    success: (r) => (r.duplicate ? null : `${r.code} added`),
    onSuccess: (r) => {
      setError(null);
      if (r.duplicate) toast.info(`${r.code} is already in the basket`, { id: `dup-${r.itemId}` });
    },
    onError: setError,
  });

  React.useEffect(() => {
    if (pendingItem && !addedPending.current && c.locationId) {
      addedPending.current = true;
      void add.run(c.id, { itemId: pendingItem.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItem, c.locationId]);

  return (
    <div className="grid gap-5 pb-24 lg:grid-cols-[1fr_380px] lg:pb-0">
      <div className="min-w-0 space-y-4">
        <Card className="p-5 md:p-6">
          <h2 className="text-[18px] font-bold tracking-tight">Add Equipment</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            From <strong className="text-ink-2">{detail.locationName}</strong>. Configurations and Kits include their contents automatically.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { key: "scan" as const, label: "Scan QR", icon: ScanLine },
              { key: "search" as const, label: "Search Inventory", icon: Search },
              { key: "browse" as const, label: "Browse Inventory", icon: LayoutGrid },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => {
                  setMode(o.key);
                  if (o.key === "scan") setScanOpen(true);
                }}
                aria-pressed={mode === o.key}
                className={cn(
                  "flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-2xl border-2 p-2 text-center text-[13px] font-semibold transition-all active:scale-[0.97]",
                  mode === o.key ? "border-brand bg-brand/[0.06] text-ink" : "border-line text-ink-2 hover:border-line-2",
                )}
              >
                <o.icon className={cn("size-6", o.key === "scan" && "text-brand")} />
                {o.label}
              </button>
            ))}
          </div>
        </Card>
        <ErrorPanel error={error} />
        {mode !== "scan" && (
          <CandidateList checkoutId={c.id} browse={mode === "browse"} adding={add.pending} onAdd={(itemId, quantity, override) => add.run(c.id, { itemId, quantity, override })} canOverride={canOverride} />
        )}
        {mode === "scan" && (
          <Card className="flex flex-col items-center p-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-3xl bg-brand text-white shadow-[0_12px_28px_-10px_var(--brand)]">
              <ScanLine className="size-8" />
            </span>
            <p className="mt-4 text-[15px] font-semibold">Scan equipment QR codes</p>
            <p className="mt-1 max-w-xs text-[13.5px] text-muted">Keep scanning; each item is validated and added. Repeated scans are ignored.</p>
            <Button variant="brand" size="lg" className="mt-5" onClick={() => setScanOpen(true)}>
              <ScanLine /> Open scanner
            </Button>
          </Card>
        )}
      </div>

      <div className="hidden lg:block">
        <div className="sticky top-[96px]">
          <Basket detail={detail} />
          <Button variant="brand" size="lg" className="mt-4 w-full" disabled={!roots.length} onClick={onNext}>
            Review Checkout <ArrowRight />
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
        </div>
      </div>

      {/* Mobile basket bar */}
      <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-line bg-surface/95 p-3 backdrop-blur-xl lg:hidden">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => setBasketOpen(true)}>
          <ShoppingBasket /> Basket
          <motion.span key={roots.length} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="rounded-full bg-brand px-2 py-0.5 text-[12px] text-white">
            {roots.length}
          </motion.span>
        </Button>
        <Button variant="brand" size="lg" className="flex-1" disabled={!roots.length} onClick={onNext}>
          Review <ArrowRight />
        </Button>
      </div>
      <Dialog open={basketOpen} onOpenChange={setBasketOpen} title="Checkout Basket" description={`${plural(roots.length, "item")} selected`}>
        <Basket detail={detail} bare />
      </Dialog>

      <ScannerOverlay
        open={scanOpen}
        onClose={() => {
          setScanOpen(false);
          router.refresh();
        }}
        title="Scan equipment"
        hint="Scan each item to add it to the basket"
        onScan={async (text) => {
          const r = await add.run(c.id, { scan: text });
          if (r.ok) return { ok: true, message: r.data.duplicate ? `${r.data.code} already in basket` : `${r.data.code} ${r.data.name} added` };
          return { ok: false, message: r.error.message };
        }}
      />
    </div>
  );
}

function CandidateList({
  checkoutId,
  browse,
  onAdd,
  adding,
  canOverride,
}: {
  checkoutId: string;
  browse: boolean;
  onAdd: (itemId: string, quantity?: number, override?: boolean) => Promise<unknown>;
  adding: boolean;
  canOverride: boolean;
}) {
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState<InventoryKind | "all">("all");
  const [loaded, setItems] = React.useState<Candidate[] | null>(null);
  const items = !browse && !q.trim() ? null : loaded;
  const [loading, setLoading] = React.useState(false);
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [overrideItem, setOverrideItem] = React.useState<Candidate | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await searchCandidatesAction(checkoutId, q, kind);
    setLoading(false);
    if (res.ok) setItems(res.data as Candidate[]);
  }, [checkoutId, q, kind]);

  React.useEffect(() => {
    if (!browse && !q.trim()) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, kind, browse, load]);

  const addAndReload = async (id: string, quantity?: number, override?: boolean) => {
    await onAdd(id, quantity, override);
    load();
  };

  return (
    <Card className="p-4 md:p-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID, name or tech spec" className="pl-10" aria-label="Search inventory" autoFocus={!browse} />
        {loading && <Loader2 className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
      </div>
      {browse && (
        <div className="no-scrollbar -mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={[{ value: "all" as const, label: "All" }, ...INVENTORY_KINDS.map((k) => ({ value: k, label: KIND_PLURAL[k] }))]}
          />
        </div>
      )}
      <div className="mt-3">
        {items === null ? (
          <p className="py-8 text-center text-[14px] text-muted">Type to search inventory at this location.</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-muted">No matching equipment.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => {
              const reservedOnly = !it.eligible && it.flags.length === 1 && it.flags[0] === "Reserved";
              return (
                <motion.li layout key={it.id} className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3", it.eligible ? "border-line" : "border-line bg-surface-2/70")}>
                  <KindIcon kind={it.kind} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">
                      <span className="font-mono text-[12px] text-muted">{it.code}</span> {it.name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                      <StatusBadge status={it.status} />
                      <span>{KIND_LABEL[it.kind]}</span>
                      {it.children > 0 && <span>· {plural(it.children, "item")} inside</span>}
                      {it.kind === "consumable" && it.unallocated !== null && <span>· {formatQty(it.unallocated, it.unit as never)} available</span>}
                      {it.locationName && <span>· {it.locationName}</span>}
                    </div>
                    {!it.eligible && it.message && (
                      <p className="mt-1 flex items-start gap-1 text-[12.5px] font-medium text-[#b45309]">
                        <Ban className="mt-0.5 size-3.5 shrink-0" /> {it.message}
                      </p>
                    )}
                  </div>
                  {it.inBasket ? (
                    <span className="flex items-center gap-1 text-[13px] font-semibold text-available">
                      <Check className="size-4" /> In basket
                    </span>
                  ) : it.eligible ? (
                    it.kind === "consumable" ? (
                      <div className="flex items-center gap-2">
                        <Input
                          inputMode="decimal"
                          value={qty[it.id] ?? ""}
                          onChange={(e) => setQty((s) => ({ ...s, [it.id]: e.target.value }))}
                          placeholder="Qty"
                          className="h-10 w-20"
                          aria-label={`Quantity of ${it.name}`}
                        />
                        <Button size="sm" disabled={!Number(qty[it.id]) || adding} onClick={() => addAndReload(it.id, Number(qty[it.id]))}>
                          <Plus /> Add
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" disabled={adding} onClick={() => addAndReload(it.id)}>
                        <Plus /> Add
                      </Button>
                    )
                  ) : reservedOnly && canOverride ? (
                    <Button size="sm" variant="secondary" onClick={() => setOverrideItem(it)}>
                      Override
                    </Button>
                  ) : null}
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(overrideItem)}
        onOpenChange={(o) => !o && setOverrideItem(null)}
        title="Check out reserved equipment?"
        description={`${overrideItem?.message} You will need to give a reason when confirming the checkout.`}
        confirmLabel="Add anyway"
        onConfirm={async () => {
          if (overrideItem) await addAndReload(overrideItem.id, undefined, true);
          setOverrideItem(null);
        }}
      />
    </Card>
  );
}

function Basket({ detail, bare }: { detail: CheckoutDetail; bare?: boolean }) {
  const c = detail.checkout;
  const roots = detail.lines.filter((l) => !l.parentId);
  const remove = useAction(removeFromBasketAction, { success: "Removed from basket" });
  const updateQty = useAction(updateBasketQuantityAction, {});
  const body = (
    <>
      {roots.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <ShoppingBasket className="size-8 text-muted/60" />
          <p className="mt-2 text-[14px] text-muted">Basket is empty</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {roots.map((l) => (
              <motion.li
                key={l.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-3 py-3"
              >
                <KindIcon kind={l.kind} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11.5px] font-semibold text-muted">{l.code}</p>
                  <p className="truncate text-[14px] font-semibold">{l.name}</p>
                  <p className="text-[12px] text-muted">
                    {KIND_LABEL[l.kind]} · {l.locationName}
                  </p>
                </div>
                {!l.isTracked ? (
                  <div className="flex items-center gap-1">
                    <button
                      className="flex size-8 items-center justify-center rounded-lg border border-line-2 disabled:opacity-40"
                      aria-label="Decrease quantity"
                      disabled={l.quantity <= 1 || updateQty.pending}
                      onClick={() => updateQty.run(c.id, l.id, Math.max(1, l.quantity - 1))}
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="min-w-12 text-center text-[13px] font-semibold tabular">{formatQty(l.quantity, l.unit)}</span>
                    <button
                      className="flex size-8 items-center justify-center rounded-lg border border-line-2 disabled:opacity-40"
                      aria-label="Increase quantity"
                      disabled={updateQty.pending}
                      onClick={() => updateQty.run(c.id, l.id, l.quantity + 1)}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <StatusBadge status={l.itemStatus} />
                )}
                <button
                  onClick={() => remove.run(c.id, l.id)}
                  className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-missing/10 hover:text-missing"
                  aria-label={`Remove ${l.code}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </>
  );
  if (bare) return body;
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[15px] font-bold">
          <ShoppingBasket className="size-5 text-brand" /> Checkout Basket
        </h3>
        <Badge tone="brand">{roots.length}</Badge>
      </div>
      {body}
    </Card>
  );
}

/* ---------------- Review ---------------- */

function ReviewStep({
  detail,
  canOverride,
  onBack,
  onDone,
  locations,
}: {
  detail: CheckoutDetail;
  canOverride: boolean;
  onBack: () => void;
  onDone: (d: { code: string; itemCount: number }) => void;
  locations: Loc[];
}) {
  const c = detail.checkout;
  const roots = detail.lines.filter((l) => !l.parentId);
  const [overrideReason, setOverrideReason] = React.useState("");
  const confirm = useAction(confirmCheckoutAction, {
    toastErrors: false,
    refresh: false,
    onSuccess: (d) => {
      toast.success("Checkout completed", { id: `done-${d.code}` });
      onDone({ code: d.code, itemCount: d.itemCount });
    },
    onError: (e) => toast.error("Checkout blocked", { description: e.message, id: `blocked-${e.message}` }),
  });
  void locations;
  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <ErrorPanel error={confirm.error} />
      <Card className="p-5 md:p-6">
        <h2 className="text-[18px] font-bold tracking-tight">Review Checkout</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-4">
          {[
            { label: "Event / Session", value: c.eventName, icon: PackageCheck },
            { label: "Trainer / User", value: detail.userName, icon: UserRound },
            { label: "Storage Location", value: detail.locationName, icon: MapPin },
            { label: "Expected return", value: c.dueAt ? formatDateTime(c.dueAt) : "-", icon: CheckCircle2 },
          ].map((d) => (
            <div key={d.label} className="rounded-2xl bg-surface-2 p-3">
              <dt className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <d.icon className="size-3.5" /> {d.label}
              </dt>
              <dd className="mt-1 text-[14.5px] font-semibold">{d.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h3 className="text-[15px] font-bold">Checkout Basket</h3>
          <span className="text-[13px] text-muted">{plural(roots.length, "item")}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-muted">
                {["ID", "Name", "Type", "Status", "Location", "Quantity"].map((h) => (
                  <th key={h} className="px-5 py-2 font-semibold first:pl-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roots.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-mono text-[12.5px] font-semibold">{l.code}</td>
                  <td className="px-5 py-3 font-semibold">{l.name}</td>
                  <td className="px-5 py-3">{KIND_LABEL[l.kind]}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={l.itemStatus} />
                  </td>
                  <td className="px-5 py-3">{l.locationName}</td>
                  <td className="px-5 py-3 tabular">{l.isTracked ? 1 : formatQty(l.quantity, l.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">
          Configurations and Kits are issued with all their tracked contents and allocated consumables. Everything is validated again when you confirm.
        </p>
      </Card>
      {canOverride && (
        <Card className="p-5">
          <Field label="Reservation override reason" htmlFor="override" hint="Only needed if you added equipment reserved for another session.">
            <Input id="override" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          </Field>
        </Card>
      )}
      <StickyActions>
        <Button variant="secondary" size="lg" onClick={onBack} className="flex-1 lg:flex-none">
          <ArrowLeft /> Back
        </Button>
        <Button variant="brand" size="lg" className="flex-[2] lg:flex-none" loading={confirm.pending} disabled={!roots.length} onClick={() => confirm.run(c.id, overrideReason || null)}>
          {confirm.pending ? "Validating equipment..." : "Confirm Checkout"}
        </Button>
      </StickyActions>
    </div>
  );
}

function CheckoutSuccess({ checkoutId, code, itemCount }: { checkoutId: string; code: string; itemCount: number }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center">
      <div className="relative">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 size-2.5 rounded-full"
            style={{ background: i % 3 === 0 ? "var(--brand)" : i % 3 === 1 ? "var(--brand-2)" : "var(--brand-3)" }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: Math.cos((i / 10) * Math.PI * 2) * 90, y: Math.sin((i / 10) * Math.PI * 2) * 90, opacity: 0 }}
            transition={{ duration: 0.9, delay: 0.25, ease: "easeOut" }}
          />
        ))}
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="flex size-24 items-center justify-center rounded-[32px] bg-available text-white shadow-[0_20px_40px_-12px_rgb(22_163_74/0.6)]"
        >
          <Check className="size-12" strokeWidth={3} />
        </motion.div>
      </div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <h1 className="mt-8 text-[26px] font-bold tracking-tight">Checkout completed</h1>
        <p className="mt-2 text-[15px] text-muted">
          {code} · {plural(itemCount, "line")} issued, including assembly contents.
        </p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href={`/checkouts/${checkoutId}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-5 font-semibold text-white">
            View session <ArrowRight className="size-4" />
          </Link>
          <Link href="/dashboard" className="inline-flex h-12 items-center justify-center rounded-2xl border border-line-2 bg-surface px-5 font-semibold">
            Back to dashboard
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
