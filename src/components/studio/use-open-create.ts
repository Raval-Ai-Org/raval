"use client";

// One way to start making something, shared by the Create launcher and Home's
// cards: a video needs a plan with videos (the upgrade screen otherwise), the
// creator video ad opens its own studio, anything else opens the Studio
// composer on that format.

import { useCallback } from "react";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { rememberStudioType } from "@/hooks/use-studio";
import { emitAppEvent } from "@/lib/app-events";
import type { PlanId } from "@/lib/billing/catalog";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import type { StudioType } from "@/lib/studio/formats";
import { chooseType, openComposer } from "@/lib/studio/session-store";

export type CreateChoice = StudioType | "ugc";

export function useOpenCreate() {
  const billing = useEntitlements();
  const videoLock: PlanId | null =
    billing.data && !billing.data.features.ugc.allowed
      ? billing.data.features.ugc.requiredPlan
      : null;
  const lockFor = useCallback(
    (choice: CreateChoice) => (choice === "ugc" || choice === "video" ? videoLock : null),
    [videoLock],
  );
  /** Returns false when nothing opened (locked, or no workspace). */
  const open = useCallback(
    (choice: CreateChoice, opts?: { brief?: string }): boolean => {
      if (lockFor(choice)) {
        openFeatureUpgrade("ugc");
        return false;
      }
      if (choice === "ugc") {
        emitAppEvent("open:ugc-studio");
        return true;
      }
      rememberStudioType(choice);
      const id = openComposer({ type: choice, brief: opts?.brief });
      if (!id) return false; // openComposer already explained why
      chooseType(id, choice);
      return true;
    },
    [lockFor],
  );
  return { open, lockFor };
}
