"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronRight, ClipboardCheck, Eye, Lock, PackageCheck, PackageOpen, X } from "lucide-react";
import { scanLookupAction } from "@/app/actions/inventory";
import { KIND_LABEL, type InventoryKind, type ItemStatus, type QuantityUnit } from "@/lib/domain";
import { formatQty, plural } from "@/lib/utils";
import { QrScanner } from "./qr-scanner";
import { KindIcon, StatusBadge } from "../status";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";

type Result = {
  id: string;
  code: string;
  name: string;
  kind: InventoryKind;
  status: ItemStatus;
  reasons: string[];
  checkoutBlocked: boolean;
  locationName: string | null;
  techSpec: string | null;
  ancestors: { id: string; code: string; name: string; kind: InventoryKind }[];
  checkedOutCode: string | null;
  activeCheckout: { checkoutId: string; lineId: string } | null;
  contents: number;
  stockUnallocated: number | null;
  unit: QuantityUnit | null;
  canInspect: boolean;
};

export function ScanView() {
  const router = useRouter();
  const [result, setResult] = React.useState<Result | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black lg:static lg:mx-auto lg:my-8 lg:h-[720px] lg:max-w-md lg:overflow-hidden lg:rounded-[28px]">
      <div className="flex items-center justify-between bg-sidebar px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <button onClick={() => router.back()} className="flex size-11 items-center justify-center rounded-full bg-white/10" aria-label="Back">
          <ArrowLeft className="size-5" />
        </button>
        <p className="text-[16px] font-semibold">Scan equipment</p>
        <span className="size-11" />
      </div>
      <QrScanner
        className="min-h-0 flex-1 pb-safe"
        active={!result}
        onScan={async (text) => {
          const r = await scanLookupAction(text);
          if (!r.ok) return { ok: false, message: r.error.message };
          setTimeout(() => setResult(r.data as Result), 450);
          return { ok: true, message: `${r.data.code} ${r.data.name}` };
        }}
      />
      <AnimatePresence>
        {result && (
          <>
            <motion.div className="absolute inset-0 z-10 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setResult(null)} />
            <motion.div
              role="dialog"
              aria-label={`${result.code} ${result.name}`}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => info.offset.y > 120 && setResult(null)}
              className="pb-safe absolute inset-x-0 bottom-0 z-20 rounded-t-[28px] bg-surface p-5 text-ink shadow-[var(--shadow-float)]"
            >
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line-2" aria-hidden />
              <div className="flex items-start gap-3">
                <KindIcon kind={result.kind} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[12.5px] font-semibold text-muted">{result.code}</p>
                  <p className="truncate text-[19px] font-bold tracking-tight">{result.name}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                    <StatusBadge status={result.status} />
                    <span>{KIND_LABEL[result.kind]}</span>
                    {result.locationName && <span>· {result.locationName}</span>}
                    {result.contents > 0 && <span>· {plural(result.contents, "item")} inside</span>}
                    {result.kind === "consumable" && <span>· {formatQty(result.stockUnallocated ?? 0, result.unit)} available</span>}
                  </div>
                </div>
                <button onClick={() => setResult(null)} className="flex size-10 items-center justify-center rounded-full hover:bg-ink/5" aria-label="Close">
                  <X className="size-5" />
                </button>
              </div>

              {result.ancestors.length > 0 && (
                <div className="mt-4 rounded-2xl bg-assigned/[0.08] p-3">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                    <Lock className="size-4" /> Assigned: cannot be checked out on its own
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-[13px] text-ink-2">
                    {[...result.ancestors].reverse().map((a, i) => (
                      <React.Fragment key={a.id}>
                        {i > 0 && <ChevronRight className="size-3.5" />}
                        <Link href={`/inventory/${a.id}`} className="font-semibold hover:underline">
                          {KIND_LABEL[a.kind]} {a.code}
                        </Link>
                      </React.Fragment>
                    ))}
                    <ChevronRight className="size-3.5" /> {result.code}
                  </p>
                </div>
              )}
              {result.reasons.length > 0 && (
                <ul className="mt-3 space-y-0.5 text-[13px] text-[#b45309]">
                  {result.reasons.slice(0, 3).map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2">
                {result.activeCheckout ? (
                  <Link href={`/checkouts/${result.activeCheckout.checkoutId}/return?line=${result.activeCheckout.lineId}`} className={cn(buttonVariants({ variant: "checkin", size: "lg" }), "col-span-2")}>
                    <PackageCheck /> Return
                  </Link>
                ) : result.ancestors.length ? (
                  <Link href={`/checkouts/new?item=${result.ancestors[result.ancestors.length - 1].id}`} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "col-span-2")}>
                    <PackageOpen /> Check out {result.ancestors[result.ancestors.length - 1].code}
                  </Link>
                ) : (
                  <Link
                    href={`/checkouts/new?item=${result.id}`}
                    aria-disabled={result.checkoutBlocked}
                    className={cn(buttonVariants({ variant: "brand", size: "lg" }), "col-span-2", result.checkoutBlocked && "pointer-events-none opacity-50")}
                  >
                    <PackageOpen /> {result.checkoutBlocked ? "Checkout blocked" : "Add to Checkout"}
                  </Link>
                )}
                {result.canInspect && (
                  <Link href={`/inspections/new?root=${result.id}`} className={buttonVariants({ variant: "secondary", size: "lg" })}>
                    <ClipboardCheck /> Inspect
                  </Link>
                )}
                <Link href={`/inventory/${result.id}`} className={cn(buttonVariants({ variant: "secondary", size: "lg" }), !result.canInspect && "col-span-2")}>
                  <Eye /> Details
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
