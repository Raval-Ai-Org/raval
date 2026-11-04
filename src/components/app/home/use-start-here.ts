"use client";

// The "Start here" facts in the browser: three free reads the app already
// makes (Brain overview, the workspace pulse, the saved Brand DNA), turned
// into steps by the pure `startHere`.

import { useMemo } from "react";
import { useBrainOverview } from "@/components/app/brain/use-brain";
import { useWorkspacePulse } from "@/components/app/pulse/use-pulse";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { hasSavedLook, startHere } from "@/lib/home/start-here";

export function useStartHere(workspaceId: string) {
  const brain = useBrainOverview(workspaceId);
  const pulse = useWorkspacePulse(workspaceId);
  const { dna } = useBrandDna(workspaceId);
  const ready = Boolean(brain.data) && Boolean(pulse.data);
  const view = useMemo(
    () =>
      startHere({
        brandHealth: brain.data?.brains.brand.health ?? null,
        products: pulse.data ? pulse.data.products.length : null,
        hasLook: hasSavedLook(dna.look),
        hasGoal: Boolean(pulse.data?.goal ?? brain.data?.goal),
      }),
    [brain.data, pulse.data, dna.look],
  );
  return { ...view, ready, pulse: pulse.data ?? null };
}
