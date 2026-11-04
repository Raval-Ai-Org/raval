"use client";

// Top bar: credits left (click → Plan & billing) and, for owners on Free, an
// Upgrade button. The number turns amber when under 20% of the month's
// allowance and red when empty (walletView, shared with Mox's gauge). On Free
// the pill says the credits are the free ones, and the Upgrade button glows
// once they run low.

import { ArrowUpRight, Bolt, Crown } from "@/components/icons";
import { PLANS } from "@/lib/billing/catalog";
import { emitAppEvent } from "@/lib/app-events";
import { formatNumber, walletView } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";

/**
 * The top bar's corner (Holo's "Starter ↗"): just the plan. The balance lives
 * in Mox's gauge at the bottom of the sidebar, so it is never shown twice.
 * Owners on Free, or running low, get Upgrade instead.
 */
export function PlanChip({ className }: { className?: string }) {
  const { data } = useEntitlements();
  if (!data) return null;
  const w = walletView(data);
  if (w.canUpgrade && (w.free || w.tone !== "ok")) {
    return (
      <button
        type="button"
        onClick={() =>
          emitAppEvent(
            "open:upgrade",
            w.credits <= 0 ? { code: "insufficient_balance", meter: "credits" } : undefined,
          )
        }
        className={cn(
          "ds-grad-pill inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px]",
          className,
        )}
      >
        <Crown className="h-3.5 w-3.5" aria-hidden />
        Upgrade
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => emitAppEvent("open:usage")}
      title="Plan & billing"
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12.5px] font-semibold text-foreground/80 transition hover:bg-[var(--ds-well-bg)] hover:text-foreground",
        className,
      )}
    >
      {PLANS[w.plan].label}
      <ArrowUpRight className="h-3.5 w-3.5 text-[var(--mox-green-deep)] dark:text-[var(--mox-lime)]" />
    </button>
  );
}

export function WalletPill({ className }: { className?: string }) {
  const { data } = useEntitlements();
  if (!data) return null;
  const w = walletView(data);
  const { credits, points, reserved, free } = w;
  const tone =
    w.tone === "empty" ? "text-destructive" : w.tone === "low" ? "text-warning" : "text-foreground";
  const low = w.tone !== "ok";
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={() => emitAppEvent("open:usage")}
        title={`${points === null ? "" : `${formatNumber(points)} creation points · `}${formatNumber(credits)} wallet credits available${reserved > 0 ? ` · ${formatNumber(reserved)} reserved for pending work` : ""}. Open Plan & billing`}
        aria-label={`${points === null ? "" : `${formatNumber(points)} creation points, `}${formatNumber(credits)} wallet credits available, ${formatNumber(reserved)} reserved. Open Plan & billing`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-3 text-[12.5px] font-semibold tabular-nums shadow-[var(--ds-card-shadow)] transition-all hover:-translate-y-px hover:shadow-[var(--ds-card-shadow-hover)]"
      >
        <Bolt
          className="h-3.5 w-3.5 text-[var(--mox-green-deep)] dark:text-[var(--mox-lime)]"
          aria-hidden
        />
        <span className={points === null ? tone : points <= 0 ? "text-warning" : "text-foreground"}>
          {points === null ? formatNumber(credits) : `${formatNumber(points)} points`}
        </span>
        {reserved > 0 && (
          <span className="text-[11px] font-medium text-muted-foreground">
            + {formatNumber(reserved)} reserved
          </span>
        )}
        {free && (
          <span className="hidden font-medium text-muted-foreground lg:inline">
            {credits === 1 ? "free credit" : "free credits"}
          </span>
        )}
      </button>
      {w.canUpgrade && (
        <button
          type="button"
          onClick={() =>
            emitAppEvent(
              "open:upgrade",
              credits <= 0 ? { code: "insufficient_balance", meter: "credits" } : undefined,
            )
          }
          className={cn(
            "ds-grad-pill inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px]",
            low && "animate-pulse",
          )}
        >
          <Crown className="h-3.5 w-3.5" aria-hidden />
          Upgrade
        </button>
      )}
    </div>
  );
}
