import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[transform,background-color,box-shadow,color] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-ink/90",
        brand: "bg-brand text-white hover:brightness-105",
        reserve: "bg-reserve text-white hover:brightness-105",
        checkin: "bg-checkin text-white hover:brightness-105",
        secondary: "bg-surface text-ink border border-line-2 hover:bg-surface-2",
        ghost: "text-ink-2 hover:bg-ink/5",
        danger: "bg-missing text-white hover:brightness-95",
        "danger-outline": "border border-missing/30 text-missing hover:bg-missing/5",
        link: "text-brand underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-9 px-3 text-[13px] rounded-lg",
        md: "h-11 px-4 text-[14px]",
        lg: "h-12 px-5 text-[15px] rounded-2xl",
        xl: "h-14 px-6 text-base rounded-2xl",
        icon: "size-11 rounded-xl",
        "icon-sm": "size-9 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);
