"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accessible modal (Radix) with a scale/fade transition. On small screens it docks to the
 * bottom as a sheet with a slide transition.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </D.Overlay>
            <D.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                className={cn(
                  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[28px] bg-surface shadow-[var(--shadow-float)] outline-none",
                  "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px]",
                  width,
                  className,
                )}
                initial={{ opacity: 0, y: 40, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 30, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              >
                <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-2 sm:hidden" aria-hidden />
                <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4 sm:px-6 sm:pt-6">
                  <div className="min-w-0">
                    <D.Title className="text-[18px] font-semibold tracking-tight text-ink">{title}</D.Title>
                    {description ? (
                      <D.Description className="mt-1 text-[14px] text-muted">{description}</D.Description>
                    ) : (
                      <D.Description className="sr-only">{title}</D.Description>
                    )}
                  </div>
                  <D.Close className="-mr-2 -mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink" aria-label="Close">
                    <X className="size-5" />
                  </D.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
                {footer && (
                  <div className="pb-safe flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                    {footer}
                  </div>
                )}
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  onConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="h-11 rounded-xl border border-line-2 px-4 text-[14px] font-semibold text-ink hover:bg-surface-2"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold text-white disabled:opacity-60",
              tone === "danger" ? "bg-missing" : "bg-ink",
            )}
          >
            {loading ? "Saving..." : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
