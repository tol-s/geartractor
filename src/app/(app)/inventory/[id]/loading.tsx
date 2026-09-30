import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading equipment">
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-6 w-48 rounded-full" />
      </div>
      <Skeleton className="h-11 w-full max-w-xl" />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Skeleton className="h-96 rounded-[20px]" />
        <Skeleton className="h-72 rounded-[20px]" />
      </div>
    </div>
  );
}
