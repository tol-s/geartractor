import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex flex-col items-center gap-3 md:items-start">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-7 w-36 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
        <Skeleton className="col-span-2 h-44 rounded-[28px] md:col-span-1 md:h-56" />
        <Skeleton className="h-36 rounded-[28px] md:h-56" />
        <Skeleton className="h-36 rounded-[28px] md:h-56" />
      </div>
      <Skeleton className="h-24 rounded-[20px]" />
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-36 rounded-[20px]" />
        <Skeleton className="h-36 rounded-[20px]" />
        <Skeleton className="h-36 rounded-[20px]" />
      </div>
    </div>
  );
}
