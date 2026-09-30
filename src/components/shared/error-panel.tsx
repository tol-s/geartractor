"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { OctagonAlert } from "lucide-react";
import type { ActionError } from "@/server/errors";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";

/** Inline, human-readable explanation of why an action was blocked, with next steps. */
export function ErrorPanel({ error, className }: { error: ActionError | null; className?: string }) {
  if (!error) return null;
  const extra = (error.details ?? []).filter((d) => d !== error.message).slice(0, 5);
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      className={cn("rounded-2xl border border-missing/25 bg-missing/[0.06] p-4", className)}
    >
      <div className="flex gap-3">
        <OctagonAlert className="mt-0.5 size-5 shrink-0 text-missing" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink">{error.title}</p>
          <p className="mt-0.5 text-[14px] text-ink-2">{error.message}</p>
          {extra.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
              {extra.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          {error.href && (
            <Link href={error.href} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3")}>
              {error.href.startsWith("/inventory/") ? "View Item" : "Open"}
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  );
}
