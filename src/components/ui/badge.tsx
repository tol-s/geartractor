import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-ink/[0.06] text-ink-2",
  green: "bg-available/12 text-[#15803d]",
  amber: "bg-inspection/15 text-[#b45309]",
  red: "bg-missing/12 text-[#dc2626]",
  darkred: "bg-rejected/12 text-rejected",
  blue: "bg-checked-out/12 text-checked-out",
  purple: "bg-reserved/12 text-reserved",
  orange: "bg-consumable/14 text-[#c2410c]",
  slate: "bg-assigned/12 text-assigned",
  brand: "bg-brand/12 text-brand",
  dark: "bg-ink text-white",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold leading-none",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
