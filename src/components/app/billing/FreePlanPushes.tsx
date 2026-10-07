"use client";

// Quiet, always-visible reasons to upgrade, shown inside the app instead of in
// a pop-up: a Free plan card in the sidebar, a line above the chat box when
// free credits run low, and a list of what a bigger plan unlocks in Plan &
// billing. Each one only opens the upgrade screen when the person clicks.
//
// The `*View` components are presentational (`/upgrade-lab?scene=pushes`
// renders them with sample data); the ones without the suffix read the real plan.

import { useState } from "react";
import { ArrowRight, Bolt, Crown, X } from "@/components/icons";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { emitAppEvent } from "@/lib/app-events";
import {
  FEATURES,
  PLANS,
  SIGNUP_GRANT,
  isFeatureAvailable,
  type FeatureKey,
  type PlanId,
} from "@/lib/billing/catalog";
import { asPlan, formatNumber, freeNudge, type FreeNudge } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";
import { PlanLock, PrimaryButton } from "./billing-ui";

const MONTHLY = formatNumber(PLANS.starter.allowances.credits);

function openPlans(credits: number) {
  emitAppEvent(
    "open:upgrade",
    credits <= 0 ? { code: "insufficient_balance", meter: "credits" } : undefined,
  );
}

/** The owner's Free plan state, or null on a paid plan, for a teammate, or while loading. */
function useFreeOwner(): { credits: number; nudge: FreeNudge | null } | null {
  const { data } = useEntitlements();
  if (!data?.isOwner || asPlan(data.entitledPlan) !== "free") return null;
  const credits = data.meters.credits.available;
  return { credits, nudge: freeNudge({ credits, nextExpiry: data.meters.credits.nextExpiry }) };
}

/* ───────────────────────────── sidebar card ───────────────────────────── */

export function FreeSidebarCardView({
  credits,
  nudge,
  onUpgrade,
  className,
}: {
  credits: number;
  nudge: FreeNudge | null;
  onUpgrade: () => void;
  className?: string;
}) {
  const total = Math.max(SIGNUP_GRANT.credits, credits);
  const left = Math.max(0, Math.min(1, credits / total));
  const tone = credits <= 0 ? "bg-destructive" : nudge?.id === "low" ? "bg-warning" : "bg-primary";
  return (
    <div
      data-testid="free-sidebar-card"
      className={cn(
        "ds-tile space-y-2.5 bg-gradient-to-br from-primary/[0.1] via-transparent to-transparent p-3",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">Free plan</span>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {formatNumber(credits)} of {formatNumber(total)} credits
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone)}
          style={{ width: `${credits > 0 ? Math.max(4, Math.round(left * 100)) : 0}%` }}
        />
      </div>
      <p className="text-[12px] leading-snug text-muted-foreground">
        {nudge ? (
          <span className="font-medium text-foreground">{nudge.title}. </span>
        ) : (
          "Free credits come once. "
        )}
        Get {MONTHLY} every month.
      </p>
      <PrimaryButton className="h-8 w-full text-[12.5px]" onClick={onUpgrade}>
        <Crown className="h-3.5 w-3.5" aria-hidden />
        Upgrade
      </PrimaryButton>
    </div>
  );
}

export function FreeSidebarCard({ className }: { className?: string }) {
  const free = useFreeOwner();
  if (!free) return null;
  return (
    <FreeSidebarCardView
      {...free}
      className={className}
      onUpgrade={() => openPlans(free.credits)}
    />
  );
}

/* ───────────────────────────── chat box line ───────────────────────────── */

export function FreeCreditStripView({
  nudge,
  onUpgrade,
  onDismiss,
  className,
}: {
  nudge: FreeNudge;
  onUpgrade: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div
      data-testid="free-credit-strip"
      className={cn(
        "mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.08] py-1 pl-3 pr-1 text-[12.5px]",
        className,
      )}
    >
      <Bolt className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 truncate">
        <span className="font-semibold">{nudge.title}.</span>{" "}
        <span className="text-muted-foreground max-sm:hidden">{nudge.text}</span>
      </span>
      <button
        type="button"
        onClick={onUpgrade}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        See plans
        <ArrowRight className="h-3 w-3" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Above the chat box, only once free credits are low, gone or about to end. */
export function FreeCreditStrip({ className }: { className?: string }) {
  const free = useFreeOwner();
  const [hidden, setHidden] = useState<string | null>(null);
  if (!free?.nudge || hidden === free.nudge.id) return null;
  const { nudge, credits } = free;
  return (
    <FreeCreditStripView
      nudge={nudge}
      className={className}
      onUpgrade={() => openPlans(credits)}
      onDismiss={() => setHidden(nudge.id)}
    />
  );
}

/* ───────────────────────── what a bigger plan unlocks ───────────────────────── */

/** The locked features worth showing first, most wanted first. */
const SHOWCASE: FeatureKey[] = [
  "autopilot",
  "ugc",
  "audience",
  "competitors",
  "market_brain",
  "geo_apply_fixes",
  "pro_chat",
  "premium_articles",
  "backlinks",
  "client_portal",
  "command_center",
  "white_label",
];

export function lockedShowcase(
  features: Partial<Record<FeatureKey, { allowed: boolean; requiredPlan: PlanId }>>,
  max = 6,
): FeatureKey[] {
  return SHOWCASE.filter(
    (key) => isFeatureAvailable(key) && features[key] && !features[key]!.allowed,
  ).slice(0, max);
}

export function LockedFeaturesView({
  locked,
  onPick,
}: {
  locked: Array<{ feature: FeatureKey; plan: PlanId }>;
  onPick: (feature: FeatureKey) => void;
}) {
  if (locked.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="locked-features">
      <h3 className="ds-label">Unlock with a bigger plan</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {locked.map(({ feature, plan }) => (
          <button
            key={feature}
            type="button"
            onClick={() => onPick(feature)}
            className="ds-tile ds-tile-hover flex flex-col gap-1 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-semibold">{FEATURES[feature].label}</span>
              <PlanLock plan={plan} />
            </span>
            <span className="text-[12.5px] leading-snug text-muted-foreground">
              {FEATURES[feature].pitch}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LockedFeatures({ onBeforeOpen }: { onBeforeOpen?: () => void }) {
  const { data } = useEntitlements();
  if (!data?.isOwner) return null;
  const locked = lockedShowcase(data.features).map((feature) => ({
    feature,
    plan: data.features[feature].requiredPlan,
  }));
  return (
    <LockedFeaturesView
      locked={locked}
      onPick={(feature) => {
        onBeforeOpen?.();
        openFeatureUpgrade(feature);
      }}
    />
  );
}
