"use client";

// Top bar: credits left (click → Plan & billing) and, for owners on Free, an
// Upgrade button. The number turns amber when under 20% of the month's
// allowance and red when empty. On Free the pill says the credits are the free
// ones, and the Upgrade button glows once they run low.

import { Bolt, Crown } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { PLANS, SIGNUP_GRANT } from "@/lib/billing/catalog";
import { asPlan, formatNumber } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";

export function WalletPill({ className }: { className?: string }) {
  const { data } = useEntitlements();
  if (!data) return null;
  const plan = asPlan(data.entitledPlan);
  const credits = data.meters.credits.available;
  const allowance = plan === "free" ? SIGNUP_GRANT.credits : PLANS[plan].allowances.credits;
  const tone =
    credits <= 0
      ? "text-destructive"
      : allowance > 0 && credits / allowance <= 0.2
        ? "text-warning"
        : "text-foreground";
  const free = plan === "free";
  const low = tone !== "text-foreground";
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={() => emitAppEvent("open:usage")}
        title="Credits left. Open Plan & billing"
        aria-label={`${formatNumber(credits)} credits left. Open Plan & billing`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-card/80 px-3 text-[12.5px] font-medium tabular-nums transition-colors hover:bg-secondary"
      >
        <Bolt className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className={tone}>{formatNumber(credits)}</span>
        {free && (
          <span className="hidden text-muted-foreground lg:inline">
            {credits === 1 ? "free credit" : "free credits"}
          </span>
        )}
      </button>
      {data.isOwner && free && (
        <button
          type="button"
          onClick={() =>
            emitAppEvent(
              "open:upgrade",
              credits <= 0 ? { code: "insufficient_balance", meter: "credits" } : undefined,
            )
          }
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
            low &&
              "shadow-[0_0_0_3px_hsl(var(--primary)/0.22),0_8px_22px_-8px_hsl(var(--primary)/0.9)]",
          )}
        >
          <Crown className="h-3.5 w-3.5" aria-hidden />
          Upgrade
        </button>
      )}
    </div>
  );
}
