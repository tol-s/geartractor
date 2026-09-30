"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={16}
      mobileOffset={{ top: 12 }}
      gap={8}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-2xl !border !border-line !bg-surface !text-ink !shadow-[var(--shadow-lift)] !font-sans !px-4 !py-3 !gap-3",
          title: "!font-semibold !text-[14px]",
          description: "!text-muted !text-[13px]",
          success: "[&_[data-icon]]:!text-available",
          error: "[&_[data-icon]]:!text-missing",
          warning: "[&_[data-icon]]:!text-inspection",
          actionButton: "!rounded-lg !bg-ink !text-white",
        },
      }}
    />
  );
}
