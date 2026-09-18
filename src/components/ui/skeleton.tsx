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
      className={cn("mx-skel rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
