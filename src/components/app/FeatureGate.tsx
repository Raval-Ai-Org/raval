"use client";

import type { ReactNode, MouseEvent, KeyboardEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { emitAppEvent } from "@/lib/app-events";
import { FEATURES, PLANS, type FeatureKey } from "@/lib/billing/catalog";
import { useEntitlements } from "@/lib/billing/use-entitlements";

/** Keep a feature entry visible and route locked clicks to the billing modal. */
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
  const openUpgrade = () =>
    emitAppEvent("billing:blocked", {
      code: "upgrade_required",
      feature,
      requiredPlan: grant?.requiredPlan ?? FEATURES[feature].minPlan,
    });
  const intercept = (event: MouseEvent<HTMLSpanElement>) => {
    if (!locked) return;
    event.preventDefault();
    event.stopPropagation();
    openUpgrade();
  };
  const interceptKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!locked || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    openUpgrade();
  };
  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
      onClickCapture={intercept}
      onKeyDownCapture={interceptKey}
      title={locked ? `${PLANS[grant!.requiredPlan].label} plan` : undefined}
    >
      {children}
      {locked && (
        <span
          className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-background p-0.5 text-muted-foreground"
          aria-label={`Requires ${PLANS[grant!.requiredPlan].label}`}
        >
          <LockKeyhole className="h-3 w-3" aria-hidden />
        </span>
      )}
    </span>
  );
}
