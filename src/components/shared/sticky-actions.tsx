import { cn } from "@/lib/utils";

/** Sticky action bar above the mobile bottom navigation; inline on desktop. */
export function StickyActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-line bg-surface/95 p-3 backdrop-blur-xl",
        "lg:static lg:z-auto lg:justify-end lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
