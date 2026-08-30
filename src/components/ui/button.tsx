import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * World-class button system.
 * - Crisp focus ring (offset, accessible)
 * - Subtle press micro-interaction (translate-y on active)
 * - Refined elevation that responds to hover
 * - Disabled + loading states first-class
 * - Icon sizing scales with button size
 */
/**
 * Unified button system — one padding/radius/motion contract, three tiers.
 *
 *   Primary   (default, destructive, premium)  — solid, high emphasis
 *   Secondary (outline, secondary, soft, glass) — bordered/tinted, medium emphasis
 *   Tertiary  (ghost, link)                    — chromeless, low emphasis
 *
 * Every tier shares:
 *   • radius        — rounded-lg (10px) at every size except pill
 *   • padding       — same per-size horizontal padding across tiers
 *   • hover motion  — -translate-y-px + tier-appropriate elevation
 *   • active motion — translate-y-0 + damped shadow, snappier duration
 *   • focus ring    — 2px offset ring using the primary token
 */
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[10px] font-medium tracking-[-0.01em] cursor-pointer select-none",
    "transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:duration-75 active:translate-y-0",
    "disabled:pointer-events-none disabled:opacity-50 disabled:saturate-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        /* ── PRIMARY tier ─────────────────────────────────────── */
        default: [
          "bg-primary text-primary-foreground",
          "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_-4px_hsl(var(--primary)/0.35)]",
          "hover:bg-[color-mix(in_oklab,hsl(var(--primary))_88%,black)] hover:-translate-y-px",
          "hover:shadow-[0_2px_4px_rgba(0,0,0,0.10),0_12px_24px_-8px_hsl(var(--primary)/0.55)]",
          "active:bg-[color-mix(in_oklab,hsl(var(--primary))_78%,black)] active:shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
        ].join(" "),
        destructive: [
          "bg-destructive text-destructive-foreground",
          "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_-4px_hsl(var(--destructive)/0.4)]",
          "hover:bg-[color-mix(in_oklab,hsl(var(--destructive))_88%,black)] hover:-translate-y-px",
          "hover:shadow-[0_2px_4px_rgba(0,0,0,0.10),0_12px_24px_-8px_hsl(var(--destructive)/0.6)]",
          "active:bg-[color-mix(in_oklab,hsl(var(--destructive))_78%,black)] active:shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
        ].join(" "),
        premium: [
          "text-white border-0",
          "bg-[linear-gradient(135deg,hsl(var(--aura-pink)),hsl(var(--aura-purple))_55%,hsl(var(--aura-indigo)))]",
          "shadow-[0_1px_0_hsl(0_0%_100%/0.3)_inset,0_10px_26px_-12px_hsl(var(--aura-purple)/0.7)]",
          "hover:-translate-y-px hover:saturate-[1.08]",
          "hover:shadow-[0_1px_0_hsl(0_0%_100%/0.4)_inset,0_16px_36px_-14px_hsl(var(--aura-purple)/0.85)]",
          "active:shadow-[0_1px_0_hsl(0_0%_100%/0.25)_inset,0_6px_14px_-8px_hsl(var(--aura-purple)/0.6)]",
        ].join(" "),

        /* ── SECONDARY tier ───────────────────────────────────── */
        outline: [
          "border border-border bg-card text-foreground",
          "shadow-[0_1px_0_rgba(0,0,0,0.02)]",
          "hover:bg-muted hover:border-foreground/25 hover:-translate-y-px",
          "hover:shadow-[0_6px_16px_-8px_rgba(0,0,0,0.18)]",
          "active:bg-secondary active:shadow-[0_1px_0_rgba(0,0,0,0.03)]",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-foreground",
          "shadow-[inset_0_0_0_1px_hsl(var(--border)/0.6)]",
          "hover:bg-muted hover:-translate-y-px",
          "hover:shadow-[inset_0_0_0_1px_hsl(var(--border)),0_6px_14px_-8px_rgba(0,0,0,0.18)]",
          "active:bg-[color-mix(in_oklab,hsl(var(--secondary))_88%,black)] active:shadow-[inset_0_0_0_1px_hsl(var(--border)/0.6)]",
        ].join(" "),
        soft: [
          "bg-primary/12 text-primary",
          "hover:bg-primary/18 hover:-translate-y-px",
          "hover:shadow-[0_6px_14px_-8px_hsl(var(--primary)/0.35)]",
          "active:bg-primary/22 active:shadow-none",
        ].join(" "),
        glass: [
          "border border-border/60 bg-card/70 text-foreground backdrop-blur",
          "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_4px_14px_-8px_rgba(0,0,0,0.2)]",
          "hover:bg-card hover:border-foreground/25 hover:-translate-y-px",
          "hover:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_10px_22px_-10px_rgba(0,0,0,0.28)]",
          "active:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]",
        ].join(" "),

        /* ── TERTIARY tier ────────────────────────────────────── */
        ghost: [
          "text-foreground/85",
          "hover:bg-muted hover:text-foreground",
          "active:bg-secondary",
        ].join(" "),
        link: [
          "h-auto p-0 text-primary underline-offset-4",
          "hover:underline hover:text-[color-mix(in_oklab,hsl(var(--primary))_85%,black)]",
          "active:text-[color-mix(in_oklab,hsl(var(--primary))_75%,black)]",
        ].join(" "),
      },
      size: {
        /* ChatGPT-aligned scale — 8px/32/36/40/48 rhythm, consistent 10px radius.
           `pill` is the only opt-in to a rounded-full shape. */
        xs: "h-7  px-2.5 text-[12.5px] rounded-md  [&_svg]:size-4",
        sm: "h-8  px-3   text-[13px]              [&_svg]:size-[18px]",
        default: "h-9  px-4   text-[14px]              [&_svg]:size-[18px]",
        lg: "h-10 px-5   text-[14.5px]            [&_svg]:size-5",
        xl: "h-12 px-6   text-[15px]              [&_svg]:size-5",
        icon: "h-9  w-9  [&_svg]:size-[18px]",
        "icon-xs": "h-7  w-7  rounded-md [&_svg]:size-4",
        "icon-sm": "h-8  w-8  [&_svg]:size-[18px]",
        "icon-lg": "h-10 w-10 [&_svg]:size-5",
        pill: "h-9  px-4  rounded-full text-[13px] [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Spinner = () => (
  <svg className="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;

    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          aria-busy={loading || undefined}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
