import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "../ui/button-variants";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "brand",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  tone?: "brand" | "reserve" | "checkin" | "green";
  className?: string;
}) {
  const toneClass = {
    brand: "bg-brand text-white",
    reserve: "bg-reserve text-white",
    checkin: "bg-checkin text-white",
    green: "bg-available text-white",
  }[tone];
  return (
    <div
      className={cn(
        "animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      <div className={cn("mb-4 flex size-14 items-center justify-center rounded-2xl", toneClass)}>
        <Icon className="size-7" aria-hidden />
      </div>
      <p className="text-[16px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[14px] text-muted">{description}</p>}
      {action && (
        <Link href={action.href} className={cn(buttonVariants({ variant: "primary" }), "mt-5")}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
