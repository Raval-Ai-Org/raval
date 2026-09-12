"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/icons";

/**
 * Button.
 *
 * Six variants across three emphasis levels, one radius, one motion contract:
 *
 *   high    default, destructive   solid fill, carries the page's main action
 *   medium  outline, secondary     bordered or tinted
 *   low     ghost, link            chromeless
 *
 * This used to offer nine variants across ten sizes — ninety combinations, of
 * which four variants were ever used. It was also the worst token offender in
 * the codebase despite being the primitive that defines them: forty-one
 * arbitrary values, nineteen hardcoded `rgba()` shadows, five one-off font
 * sizes (`text-[12.5px]`, `text-[14.5px]`…), three different radii inside the
 * one component, and `duration-200 ease-out` instead of the motion tokens
 * declared two files away. Everything below reads from the system.
 */
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "font-medium tracking-tight cursor-pointer select-none",
    "transition-[background-color,border-color,color,box-shadow,transform]",
    "duration-[--motion-duration-base] ease-[--motion-ease-standard]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
    // Icons are real SVGs now, so these selectors actually apply. Under the
    // previous font-ligature icon system they matched nothing, and every
    // button silently fell back to the icon module's own default size.
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground shadow-1",
          "hover:bg-[color-mix(in_oklab,hsl(var(--primary))_88%,hsl(var(--foreground)))]",
          "hover:shadow-2 active:shadow-none",
        ].join(" "),
        destructive: [
          "bg-destructive text-destructive-foreground shadow-1",
          "hover:bg-[color-mix(in_oklab,hsl(var(--destructive))_88%,hsl(var(--foreground)))]",
          "hover:shadow-2 active:shadow-none",
          "focus-visible:ring-destructive/55",
        ].join(" "),
        outline: [
          "border border-border bg-surface-3 text-foreground shadow-1",
          "hover:border-border-strong hover:bg-surface-2",
          "active:shadow-none",
        ].join(" "),
        secondary: [
          "bg-surface-2 text-foreground",
          "hover:bg-[color-mix(in_oklab,hsl(var(--surface-2))_92%,hsl(var(--foreground)))]",
        ].join(" "),
        ghost: "text-foreground hover:bg-surface-2",
        link: "h-auto p-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-4",
        default: "h-9 px-4 text-sm [&_svg]:size-4",
        lg: "h-10 px-5 text-sm [&_svg]:size-[18px]",
        xl: "h-12 px-6 text-base [&_svg]:size-5",
        icon: "size-9 [&_svg]:size-4",
        "icon-sm": "size-8 [&_svg]:size-4",
        "icon-lg": "size-10 [&_svg]:size-[18px]",
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
  /** Shows a spinner in place of the label without changing the button's width. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {/* The label keeps its space while loading — prepending a spinner made
            the button jump wider the instant it was clicked. */}
        {loading ? (
          <span className="absolute inset-0 grid place-items-center" aria-hidden>
            <Spinner className="size-4 animate-spin" />
          </span>
        ) : null}
        <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
          {children}
        </span>
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
