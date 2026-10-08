"use client";
// Query keys and mutations for Autopilot.
//
// Every key carries the workspace id, so the workspace provider can drop them
// all on a switch and one brand's plan can never render under another.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { emitAppEvent } from "@/lib/app-events";
import { useNavigate } from "@/lib/navigation";
import { workspacePath } from "@/lib/workspace/paths";
import type { OpportunityFormat, ProgramSettings } from "@/lib/autopilot/contracts";
import type { PlatformId } from "@/lib/social-platforms";
import {
  approveAutopilotPlan,
  decideAutopilotAction,
  decideOpportunity,
  getAgencyAutopilot,
  getAutopilot,
  getAutopilotStatus,
  retryAutopilotAction,
  setAutopilotPaused,
  startAutopilot,
  stopAutopilot,
  suggestAutopilotStrategy,
  updateAutopilot,
} from "@/lib/autopilot.functions";

export const autopilotKeys = {
  all: (ws: string | null) => ["autopilot", ws] as const,
  view: (ws: string | null) => ["autopilot", ws, "view"] as const,
  status: (ws: string | null) => ["autopilot", ws, "status"] as const,
  /** Cross-client, so it is keyed to the account rather than one workspace. */
  agency: ["account", "autopilot"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Autopilot moves by itself, so the view refetches while anything is being
 * made or sent, and stops the moment nothing is.
 */
export function useAutopilot(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: autopilotKeys.view(workspaceId),
    enabled,
    staleTime: 10_000,
    queryFn: () => getAutopilot({ data: { workspaceId } }),
    refetchInterval: (query) => {
      const view = query.state.data;
      if (!view) return false;
      const busy = view.upcoming.some((a) => a.status === "generating" || a.status === "approved");
      const fresh =
        view.program &&
        view.program.status === "running" &&
        !view.upcoming.length &&
        !view.proposed.length;
      return busy ? 5_000 : fresh ? 8_000 : false;
    },
  });
}

/** Just on / paused / not set up, and how many things wait for a person. */
export function useAutopilotStatus(workspaceId: string) {
  return useQuery({
    queryKey: autopilotKeys.status(workspaceId),
    staleTime: 60_000,
    retry: false,
    queryFn: () => getAutopilotStatus({ data: { workspaceId } }),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 60_000 : false),
  });
}

export type AutopilotPlace =
  "accounts" | "brand" | "style" | "website" | "blog" | "visibility" | "calendar";

/** Each of these lives elsewhere in Mellox; Autopilot only sends people there. */
export function useAutopilotOpen(workspaceId: string) {
  const navigate = useNavigate();
  return (target: AutopilotPlace) => {
    if (target === "calendar") navigate({ to: workspacePath(workspaceId, "", { calendar: 1 }) });
    else if (target === "accounts") emitAppEvent("open:settings", { section: "accounts" });
    else if (target === "website" || target === "blog")
      emitAppEvent("open:settings", { section: "website" });
    else if (target === "brand") emitAppEvent("open:brand-dna");
    else if (target === "style") emitAppEvent("open:brand-dna", { tab: "look" });
    else emitAppEvent("open:ai-visibility");
  };
}

/** What Mellox proposes for this brand. Asked once, kept while the setup is open. */
export function useStrategySuggestion(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...autopilotKeys.all(workspaceId), "suggestion"] as const,
    enabled,
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: () => {
      let timezone = "UTC";
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        /* keep UTC */
      }
      return suggestAutopilotStrategy({ data: { workspaceId, timezone } });
    },
  });
}

export function useAgencyAutopilot(enabled: boolean) {
  return useQuery({
    queryKey: autopilotKeys.agency,
    enabled,
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: () => getAgencyAutopilot(),
  });
}

export function useAutopilotActions(workspaceId: string) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: autopilotKeys.all(workspaceId) });
    void client.invalidateQueries({ queryKey: autopilotKeys.agency });
    // Approvals and new drafts change the calendar, the library and the review queue too.
    emitAppEvent("content:changed");
  };
  const ws = { workspaceId };

  const start = useMutation({
    mutationFn: (settings: ProgramSettings) => startAutopilot({ data: { ...ws, settings } }),
    onSuccess: () => {
      toast.success("Autopilot is on", { description: "Your first plan is being written." });
      refresh();
    },
    onError: (e) =>
      toast.error("We couldn't start Autopilot", {
        description: message(e, "Nothing was changed."),
      }),
  });

  const update = useMutation({
    mutationFn: (settings: ProgramSettings) => updateAutopilot({ data: { ...ws, settings } }),
    onSuccess: () => {
      toast.success("Saved", { description: "Changes apply from the next plan." });
      refresh();
    },
    onError: (e) =>
      toast.error("We couldn't save that", { description: message(e, "Nothing was changed.") }),
  });

  const pause = useMutation({
    mutationFn: (paused: boolean) => setAutopilotPaused({ data: { ...ws, paused } }),
    onSuccess: (_d, paused) => {
      toast.success(paused ? "Autopilot paused" : "Autopilot resumed");
      refresh();
    },
    onError: (e) =>
      toast.error("We couldn't change that", { description: message(e, "Try again.") }),
  });

  const stop = useMutation({
    mutationFn: () => stopAutopilot({ data: ws }),
    onSuccess: () => {
      toast.success("Autopilot stopped", { description: "Your drafts are still in your content." });
      refresh();
    },
    onError: (e) => toast.error("We couldn't stop it", { description: message(e, "Try again.") }),
  });

  const approvePlan = useMutation({
    mutationFn: () => approveAutopilotPlan({ data: ws }),
    onSuccess: () => {
      toast.success("Plan approved", { description: "Mellox will start making the pieces." });
      refresh();
    },
    onError: (e) =>
      toast.error("We couldn't approve the plan", { description: message(e, "Try again.") }),
  });

  const decide = useMutation({
    mutationFn: (args: { actionId: string; decision: "approve" | "skip" }) =>
      decideAutopilotAction({ data: { ...ws, ...args } }),
    onSuccess: (_d, args) => {
      toast.success(args.decision === "approve" ? "Approved" : "Skipped");
      refresh();
    },
    onError: (e) =>
      toast.error("That didn't go through", { description: message(e, "Try again.") }),
  });

  const retry = useMutation({
    mutationFn: (actionId: string) => retryAutopilotAction({ data: { ...ws, actionId } }),
    onSuccess: () => {
      toast.success("Trying again");
      refresh();
    },
    onError: (e) =>
      toast.error("We couldn't retry that", { description: message(e, "Try again.") }),
  });

  const opportunity = useMutation({
    mutationFn: (args: {
      opportunityId: string;
      decision: "create" | "dismiss";
      format?: OpportunityFormat;
      platform?: PlatformId;
    }) => decideOpportunity({ data: { ...ws, ...args } }),
    onSuccess: (result, args) => {
      if (args.decision === "create") {
        toast.success(result.created > 1 ? `${result.created} pieces on the way` : "On the way", {
          description: "It will wait for your approval before it goes out.",
        });
      }
      refresh();
    },
    onError: (e) =>
      toast.error("That didn't go through", { description: message(e, "Nothing was charged.") }),
  });

  return { start, update, pause, stop, approvePlan, decide, retry, opportunity };
}
