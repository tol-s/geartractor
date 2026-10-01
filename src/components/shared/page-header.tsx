import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-4 md:mb-7 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="-ml-1.5 mb-2 hidden h-8 items-center gap-1 rounded-lg px-1.5 text-[13px] font-semibold text-muted hover:bg-ink/5 hover:text-ink lg:inline-flex"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        )}
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink md:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-muted md:text-[15px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
