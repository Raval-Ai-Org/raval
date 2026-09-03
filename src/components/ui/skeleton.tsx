"use client";

import { cn } from "@/lib/utils";

/**
 * Theme-aware skeleton with a subtle shimmer sweep.
 * - Uses `muted` surface so it reads as loading, not as an active primary chip
 * - Layered gradient sweep for perceived responsiveness
 * - Respects reduced-motion via [data-chat-motion="reduced"] rule in styles.css
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted/60",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:animate-[skeleton-shimmer_1.6s_ease-in-out_infinite]",
        "before:bg-[linear-gradient(90deg,transparent,hsl(var(--foreground)/0.06),transparent)]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
