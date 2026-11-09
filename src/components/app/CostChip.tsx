"use client";

import { useEffect } from "react";
import { Bolt, Video } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { CREDIT_ACTIONS, type CreditAction } from "@/lib/billing/catalog";
import { formatNumber, formatVideos } from "@/lib/billing/present";
import { cn } from "@/lib/utils";

/**
 * The price on a paid button: "12 credits" or "1 video". Charged only when the
 * action succeeds. Pass `videoUnits` for video, `credits` for a price worked
 * out elsewhere (a short video clip); otherwise a catalog action.
 */
export function CostChip({
  action,
  quantity = 1,
  videoUnits,
  credits: fixedCredits,
  free,
  compact,
  announce,
  className,
}: {
  action?: CreditAction;
  quantity?: number;
  videoUnits?: number;
  credits?: number;
  /** Included in the plan (first scan, scheduled refresh): shows "Free". */
  free?: boolean;
  /** Holo-style "⚡12" on a Create pill; the full price stays in the title. */
  compact?: boolean;
  /** The price of what is being set up right now: the sidebar gauge shows it. */
  announce?: boolean;
  className?: string;
}) {
  const announced =
    typeof videoUnits === "number"
      ? { videoUnits, label: `${formatVideos(videoUnits)} video credits` }
      : !free && (action || fixedCredits !== undefined)
        ? (() => {
            const c = fixedCredits ?? Math.ceil(CREDIT_ACTIONS[action!].credits * quantity);
            return { credits: c, label: `${formatNumber(c)} ${c === 1 ? "credit" : "credits"}` };
          })()
        : null;
  const key = announce && announced ? announced.label : null;
  useEffect(() => {
    if (!key || !announced) return;
    emitAppEvent("credits:preview", announced);
    return () => emitAppEvent("credits:preview", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the label
  }, [key]);
  const base =
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-medium tabular-nums leading-4 text-muted-foreground";
  if (free) {
    return (
      <span data-slot="cost-chip" className={cn(base, "bg-primary/12 text-primary-ink", className)}>
        Free
      </span>
    );
  }
  if (typeof videoUnits === "number") {
    const text = formatVideos(videoUnits);
    return (
      <span
        data-slot="cost-chip"
        className={cn(base, className)}
        title="Uses your video balance. Charged only if it works."
      >
        <Video className="h-3 w-3 shrink-0" aria-hidden />
        {text} video {text === "1" ? "credit" : "credits"}
      </span>
    );
  }
  if (!action && fixedCredits === undefined) return null;
  const credits = fixedCredits ?? Math.ceil(CREDIT_ACTIONS[action!].credits * quantity);
  const label = `${formatNumber(credits)} ${credits === 1 ? "credit" : "credits"}`;
  return (
    <span
      data-slot="cost-chip"
      className={cn(base, className)}
      title={`${label}. Charged only if it works`}
      aria-label={compact ? label : undefined}
    >
      <Bolt className="h-3 w-3 shrink-0" aria-hidden />
      {compact ? formatNumber(credits) : label}
    </span>
  );
}
