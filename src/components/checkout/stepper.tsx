"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { CHECKOUT_STEPS } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function Stepper({
  current,
  reached,
  onSelect,
}: {
  current: number;
  reached: number;
  onSelect?: (step: number) => void;
}) {
  return (
    <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Checkout progress">
      {CHECKOUT_STEPS.map((s) => {
        const done = s.step < current || (current === 5 && s.step <= 4);
        const active = s.step === current;
        const clickable = onSelect && s.step <= reached && !active;
        return (
          <li key={s.step}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect?.(s.step)}
              aria-current={active ? "step" : undefined}
              className={cn("group flex w-full flex-col gap-2 text-left", clickable && "cursor-pointer")}
            >
              <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full bg-brand"
                  initial={false}
                  animate={{ width: done ? "100%" : active ? "50%" : "0%" }}
                  transition={{ type: "spring", stiffness: 200, damping: 30 }}
                />
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    done ? "bg-brand text-white" : active ? "bg-ink text-white" : "bg-ink/10 text-muted",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={3} /> : s.step}
                </span>
                <span className={cn("hidden truncate text-[12.5px] font-semibold sm:block", active ? "text-ink" : "text-muted", clickable && "group-hover:text-ink")}>
                  {s.label}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
