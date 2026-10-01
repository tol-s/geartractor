"use client";

import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-5 flex size-16 items-center justify-center rounded-3xl bg-missing text-white">
        <TriangleAlert className="size-8" />
      </span>
      <h1 className="text-[22px] font-bold tracking-tight">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-[15px] text-muted">We could not load this page. Please try again.</p>
      <div className="mt-6 flex gap-2">
        <button onClick={reset} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 font-semibold text-white">
          <RotateCcw className="size-4" /> Try again
        </button>
        <Link href="/dashboard" className="inline-flex h-11 items-center rounded-xl border border-line-2 bg-surface px-5 font-semibold">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
