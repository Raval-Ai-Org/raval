import { Bolt, Video } from "@/components/icons";
import { CREDIT_ACTIONS, type CreditAction } from "@/lib/billing/catalog";
import { formatNumber, formatVideos } from "@/lib/billing/present";
import { cn } from "@/lib/utils";

/**
 * The price on a paid button: "12 credits" or "1 video". Charged only when the
 * action succeeds. Pass `videoUnits` for video; otherwise a catalog action.
 */
export function CostChip({
  action,
  quantity = 1,
  videoUnits,
  free,
  className,
}: {
  action?: CreditAction;
  quantity?: number;
  videoUnits?: number;
  /** Included in the plan (first scan, scheduled refresh): shows "Free". */
  free?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-muted-foreground";
  if (free) {
    return <span className={cn(base, "bg-primary/12 text-primary", className)}>Free</span>;
  }
  if (typeof videoUnits === "number") {
    const text = formatVideos(videoUnits);
    return (
      <span
        className={cn(base, className)}
        title="Uses your video balance. Charged only if it works."
      >
        <Video className="h-3 w-3" aria-hidden />
        {text} {text === "1" ? "video" : "videos"}
      </span>
    );
  }
  if (!action) return null;
  const credits = Math.ceil(CREDIT_ACTIONS[action].credits * quantity);
  return (
    <span className={cn(base, className)} title="Charged only if it works">
      <Bolt className="h-3 w-3" aria-hidden />
      {formatNumber(credits)} {credits === 1 ? "credit" : "credits"}
    </span>
  );
}
