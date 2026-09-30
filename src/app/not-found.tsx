import Link from "next/link";
import { PackageSearch } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-5 flex size-16 items-center justify-center rounded-3xl bg-brand/10 text-brand">
        <PackageSearch className="size-8" />
      </span>
      <h1 className="text-[24px] font-bold tracking-tight">Not found</h1>
      <p className="mt-1 max-w-sm text-[15px] text-muted">This page or record does not exist, or you do not have access to it.</p>
      <Link href="/dashboard" className="mt-6 inline-flex h-11 items-center rounded-xl bg-ink px-5 font-semibold text-white">
        Back to dashboard
      </Link>
    </div>
  );
}
