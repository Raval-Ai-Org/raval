"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Lock } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { FEATURES, PLANS, type FeatureKey } from "@/lib/billing/catalog";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";

/** True when the current plan locks this feature (false while loading). */
export function useFeatureLocked(feature: FeatureKey): boolean {
  const { data } = useEntitlements();
  const grant = data?.features[feature];
  return Boolean(grant && !grant.allowed);
}

/** Open the upgrade screen for a feature. Call it from a click handler only. */
export function openFeatureUpgrade(feature: FeatureKey) {
  emitAppEvent("open:upgrade", {
    code: "upgrade_required",
    feature,
    requiredPlan: FEATURES[feature].minPlan,
  });
}

/**
 * Keep a feature entry visible on every plan. When the plan locks it, show a
 * small lock and send the click to the upgrade screen instead of the action.
 */
export function FeatureGate({
  feature,
  children,
  className,
}: {
  feature: FeatureKey;
  children: ReactNode;
  className?: string;
}) {
  const { data } = useEntitlements();
  const grant = data?.features[feature];
  const locked = Boolean(grant && !grant.allowed);
  const plan = PLANS[grant?.requiredPlan ?? FEATURES[feature].minPlan];
  const intercept = (event: MouseEvent<HTMLSpanElement>) => {
    if (!locked) return;
    event.preventDefault();
    event.stopPropagation();
    openFeatureUpgrade(feature);
  };
  const interceptKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!locked || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    openFeatureUpgrade(feature);
  };
  return (
    <span
      className={cn("relative inline-flex", className)}
      onClickCapture={intercept}
      onKeyDownCapture={interceptKey}
      title={locked ? `${FEATURES[feature].label} · ${plan.label} plan` : undefined}
    >
      {children}
      {locked && (
        <span
          className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
          role="img"
          aria-label={`Needs the ${plan.label} plan`}
        >
          <Lock className="h-2.5 w-2.5" strokeWidth={2.6} aria-hidden />
        </span>
      )}
    </span>
  );
}
