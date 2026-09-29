"use client";

// The balance in the top bar: credits and videos left. Amber when a balance is
// under 20% of the month's allowance, red when it is empty. Click opens
// Plan & billing. Free owners also get a small Upgrade pill next to it.

import { Crown, Video, Bolt } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { PLANS } from "@/lib/billing/catalog";
import { asPlan, formatNumber, formatVideos, nextPlan } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { useBillingNotices } from "@/lib/billing/use-notices";
import { cn } from "@/lib/utils";

function tone(left: number, allowance: number): string {
  if (left <= 0) return "text-destructive";
  if (allowance > 0 && left / allowance <= 0.2) return "text-warning";
  return "text-foreground";
}

export function WalletPill({ className }: { className?: string }) {
  const { data } = useEntitlements();
  const notices = useBillingNotices(Boolean(data));
  if (!data) return null;
  const unread = notices.data?.unread ?? 0;
  const plan = asPlan(data.entitledPlan);
  const allowance = PLANS[plan].allowances;
  const credits = data.meters.credits.available;
  const video = data.meters.video.available;
  const showVideo = video > 0 || allowance.videoUnits > 0;
  const upgradeTo = data.isOwner && plan === "free" ? nextPlan(plan) : null;
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={() => emitAppEvent("open:usage")}
        aria-label={`Plan and billing: ${formatNumber(credits)} credits${showVideo ? `, ${formatVideos(video)} videos` : ""} left`}
        title={data.isOwner ? "Your balance" : "The brand owner's balance"}
        className="relative inline-flex h-8 items-center gap-2.5 rounded-full border border-border/70 bg-card/80 px-3 text-[12.5px] font-medium tabular-nums transition-colors hover:bg-secondary"
      >
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
            role="img"
            aria-label={`${unread} new billing ${unread === 1 ? "notice" : "notices"}`}
          />
        )}
        <span
          className={cn("inline-flex items-center gap-1", tone(credits, allowance.credits || 100))}
        >
          <Bolt className="h-3.5 w-3.5 text-primary" aria-hidden />
          {formatNumber(credits)}
        </span>
        {showVideo && (
          <span className={cn("inline-flex items-center gap-1", tone(video, allowance.videoUnits))}>
            <Video className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {formatVideos(video)}
          </span>
        )}
      </button>
      {upgradeTo && (
        <button
          type="button"
          onClick={() => emitAppEvent("open:upgrade", undefined)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Crown className="h-3.5 w-3.5" aria-hidden />
          Upgrade
        </button>
      )}
    </div>
  );
}
