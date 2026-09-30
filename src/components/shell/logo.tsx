import { cn } from "@/lib/utils";

/** Original Gear Tractor mark: a geared wheel with a forward chevron (motion + equipment). */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={cn("shrink-0", className)} aria-hidden>
      <rect width="40" height="40" rx="12" fill="var(--brand)" />
      <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 8.5v3.2M20 28.3v3.2M8.5 20h3.2M28.3 20h3.2M11.9 11.9l2.2 2.2M25.9 25.9l2.2 2.2M11.9 28.1l2.2-2.2M25.9 14.1l2.2-2.2" />
        <circle cx="20" cy="20" r="6.8" />
        <path d="M18.4 17.2 21.4 20l-3 2.8" />
      </g>
    </svg>
  );
}

export function Wordmark({ name = "Gear Tractor", logo, className, dark }: { name?: string; logo?: string | null; className?: string; dark?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="size-9 shrink-0 rounded-xl object-contain" />
      ) : (
        <LogoMark />
      )}
      <span className={cn("truncate text-[17px] font-bold tracking-[-0.02em]", dark ? "text-white" : "text-ink")}>{name}</span>
    </span>
  );
}
