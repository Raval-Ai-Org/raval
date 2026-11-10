"use client";

// Autopilot in the chat message box's toolbar: one small pill that says
// whether it runs and opens it. The box itself is never covered or changed
// for Autopilot (Home has its own Autopilot area, HomeAutopilot), so on Home
// the pill is hidden.
import type { ReactNode } from "react";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { useNavigate } from "@/lib/navigation";
import { workspacePath } from "@/lib/workspace/paths";
import type { Section } from "../AutopilotScreen";
import { useAutopilotStatus } from "../hooks";
import { AutopilotToggle } from "./AutopilotDeck";

/** Where the full Autopilot screen is, optionally at one of its sections. */
export function autopilotPath(workspaceId: string, section?: Section): string {
  return workspacePath(workspaceId, "autopilot", {
    s: section && section !== "home" ? section : undefined,
  });
}

export function useComposerAutopilot({
  workspaceId,
  hidden = false,
}: {
  workspaceId: string;
  /** Home: the Autopilot area is on the page, so the box shows no pill. */
  hidden?: boolean;
}): { toolbarSlot: ReactNode } {
  const navigate = useNavigate();
  const status = useAutopilotStatus(workspaceId);
  const billing = useEntitlements();

  if (hidden || !status.data?.enabled) return { toolbarSlot: null };

  const program: "running" | "paused" | null =
    status.data.status === "running" || status.data.status === "paused" ? status.data.status : null;
  const grant = billing.data?.features.autopilot;
  const lockedPlan = grant && !grant.allowed && !program ? grant.requiredPlan : null;

  return {
    toolbarSlot: (
      <AutopilotToggle
        state={program === "running" ? "on" : program === "paused" ? "paused" : "off"}
        waiting={status.data.waiting ?? 0}
        lockedPlan={lockedPlan}
        onClick={() => {
          if (lockedPlan) return openFeatureUpgrade("autopilot");
          navigate({ to: autopilotPath(workspaceId) });
        }}
      />
    ),
  };
}
