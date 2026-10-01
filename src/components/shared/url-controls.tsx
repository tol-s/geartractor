"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NativeSelect } from "../ui/input";

function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const set = React.useCallback(
    (patch: Record<string, string | null | undefined>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "" || v === "all") next.delete(k);
        else next.set(k, v);
      }
      if (opts.resetPage) next.delete("page");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );
  return { params, set, pending };
}

export function SearchInput({ placeholder = "Search", param = "q", className }: { placeholder?: string; param?: string; className?: string }) {
  const { params, set, pending } = useUrlParams();
  const [value, setValue] = React.useState(params.get(param) ?? "");
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => set({ [param]: value.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-xl border border-line-2 bg-surface pl-10 pr-10 text-[15px] placeholder:text-muted/70 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
      />
      {pending ? (
        <Loader2 className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-label="Searching" />
      ) : value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-ink/5"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

export function FilterSelect({
  param,
  options,
  label,
  className,
}: {
  param: string;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  const { params, set } = useUrlParams();
  return (
    <div className={className}>
      <NativeSelect aria-label={label} value={params.get(param) ?? "all"} onChange={(e) => set({ [param]: e.target.value })} className="h-11 min-w-[150px]">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function LinkTabs({
  param,
  tabs,
  className,
  layoutId = "tabs",
}: {
  param: string;
  tabs: { value: string; label: string; count?: number }[];
  className?: string;
  layoutId?: string;
}) {
  const { params, set } = useUrlParams();
  const current = params.get(param) ?? tabs[0]?.value;
  return (
    <div role="tablist" className={cn("no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      {tabs.map((t) => {
        const active = current === t.value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => set({ [param]: t.value === tabs[0].value ? null : t.value })}
            className={cn(
              "relative h-10 shrink-0 rounded-xl px-3.5 text-[14px] font-semibold transition-colors",
              active ? "text-white" : "text-muted hover:bg-ink/5 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl bg-ink"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {t.label}
              {t.count !== undefined && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular", active ? "bg-white/20" : "bg-ink/[0.07]")}>{t.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({ page, pageCount, total, label = "results" }: { page: number; pageCount: number; total: number; label?: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  if (pageCount <= 1) {
    return <p className="mt-4 text-center text-[13px] text-muted">{total} {label}</p>;
  }
  const href = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <nav className="mt-5 flex items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-[13px] text-muted">
        Page <span className="font-semibold text-ink tabular">{page}</span> of <span className="tabular">{pageCount}</span> · {total} {label}
      </p>
      <div className="flex gap-2">
        <Link
          aria-disabled={page <= 1}
          href={href(page - 1)}
          className={cn(
            "inline-flex size-11 items-center justify-center rounded-xl border border-line-2 bg-surface hover:bg-surface-2",
            page <= 1 && "pointer-events-none opacity-40",
          )}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <Link
          aria-disabled={page >= pageCount}
          href={href(page + 1)}
          className={cn(
            "inline-flex size-11 items-center justify-center rounded-xl border border-line-2 bg-surface hover:bg-surface-2",
            page >= pageCount && "pointer-events-none opacity-40",
          )}
          aria-label="Next page"
        >
          <ChevronRight className="size-5" />
        </Link>
      </div>
    </nav>
  );
}
