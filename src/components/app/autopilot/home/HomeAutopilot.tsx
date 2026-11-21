"use client";

// Wires Home's Autopilot card. Reads only: the status (cheap, cached) and,
// once a program exists, the view. Off, pressing it opens the step-by-step
// setup; nothing is started or charged from Home.
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { emitAppEvent } from "@/lib/app-events";
import { useNavigate } from "@/lib/navigation";
import type { PulseCampaign } from "@/lib/pulse/pulse";
import { autopilotPath } from "../composer/useComposerAutopilot";
import type { LinkedPlace } from "../flow";
import { useAutopilot, useAutopilotActions, useAutopilotOpen, useAutopilotStatus } from "../hooks";
import { AutopilotHomeCard, type HomeAutopilotState } from "./AutopilotHomeCard";

export function HomeAutopilot({
  workspaceId,
  campaigns,
}: {
  workspaceId: string;
  campaigns?: PulseCampaign[];
}) {
  const navigate = useNavigate();
  const status = useAutopilotStatus(workspaceId);
  const billing = useEntitlements();
  const program = status.data?.status === "running" || status.data?.status === "paused";
  const query = useAutopilot(workspaceId, Boolean(status.data?.enabled && program));
  const actions = useAutopilotActions(workspaceId);
  const openPlace = useAutopilotOpen(workspaceId);

  // Autopilot switched off for this workspace (flag): Home shows nothing.
  if (status.data && !status.data.enabled) return null;
  if (status.error && !status.data) return null;

  const grant = billing.data?.features.autopilot;
  const lockedPlan = grant && !grant.allowed ? grant.requiredPlan : null;

  const state: HomeAutopilotState = !status.data
    ? { kind: "loading" }
    : !program
      ? lockedPlan
        ? { kind: "locked", plan: lockedPlan }
        : { kind: "off", canManage: true }
      : query.data
        ? { kind: "live", view: query.data }
        : query.error
          ? { kind: "failed" }
          : { kind: "loading" };

  const place = (target: LinkedPlace) => {
    if (target === "campaigns")
      emitAppEvent(
        "open:campaigns",
        campaigns?.length === 1 ? { campaignId: campaigns[0].id } : undefined,
      );
    else openPlace(target);
  };

  return (
    <AutopilotHomeCard
      state={state}
      campaigns={campaigns}
      handlers={{
        open: (section) => navigate({ to: autopilotPath(workspaceId, section) }),
        upgrade: () => openFeatureUpgrade("autopilot"),
        pause: (paused) => actions.pause.mutate(paused),
        place,
        retry: () => void (program ? query.refetch() : status.refetch()),
        busy: actions.pause.isPending,
      }}
    />
  );
}
