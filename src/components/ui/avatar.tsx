import { cn, initials } from "@/lib/utils";

const palette = ["#FF6B1A", "#2563EB", "#E11D74", "#16A34A", "#7C3AED", "#0EA5E9", "#F59E0B"];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: colorFor(name), fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}
