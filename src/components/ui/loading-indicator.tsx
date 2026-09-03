"use client";

/**
 * Accessible loading indicator.
 *
 * Solves the "motion-only cue" a11y failure: an animated spinner or
 * shimmer with no text alternative conveys "loading" through motion
 * only, which is invisible to screen readers AND to users with
 * `prefers-reduced-motion` (who see a static icon with no context).
 *
 * This primitive pairs the visual animation with:
 *   • `role="status"` + `aria-live="polite"` so assistive tech announces it
 *   • a visible OR sr-only label — never motion alone
 *   • an `aria-busy` container hook so tests can wait on it
 *
 * Prefer this over raw `<Loader2 className="animate-spin" />` for
 * standalone loading states. Spinners INSIDE a labeled button
 * (`<Button>Save {loading && <Loader2 />}</Button>`) are already fine —
 * the button text is the accessible name.
 */

import * as React from "react";
import { Loader2 } from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";

type Size = "xs" | "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

export interface LoadingIndicatorProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** Accessible label announced to screen readers. Default: "Loading". */
  label?: string;
  /** Show label visually. Default false (sr-only). */
  showLabel?: boolean;
  /** Icon size preset. */
  size?: Size;
  /** Layout: "inline" for buttons, "block" for standalone regions. */
  variant?: "inline" | "block";
}

export function LoadingIndicator({
  label = "Loading",
  showLabel = false,
  size = "sm",
  variant = "block",
  className,
  ...rest
}: LoadingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        variant === "block"
          ? "grid place-items-center py-8 text-muted-foreground"
          : "inline-flex items-center gap-2 text-muted-foreground",
        className,
      )}
      {...rest}
    >
      <Loader2 className={cn(SIZE[size], "animate-spin")} aria-hidden />
      {showLabel ? (
        <span className="text-[12.5px]">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}
