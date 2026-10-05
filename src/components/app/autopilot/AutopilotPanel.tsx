"use client";

// Autopilot for one workspace: loads the view, wires the decisions a person
// makes to the server, and hands both to AutopilotScreen.
import { Bot } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { emitAppEvent } from "@/lib/app-events";
import { useNavigate } from "@/lib/navigation";
import { ServerFnError } from "@/lib/rpc-client";
import { workspacePath } from "@/lib/workspace/paths";
import { AutopilotScreen, type AutopilotHandlers } from "./AutopilotScreen";
import { useAutopilot, useAutopilotActions, useStrategySuggestion } from "./hooks";

export function AutopilotPanel({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const query = useAutopilot(workspaceId);
  const actions = useAutopilotActions(workspaceId);
  const view = query.data;
  // Only asked for when there is no program yet and this person may start one.
  const suggestion = useStrategySuggestion(
    workspaceId,
    Boolean(view && !view.program && view.canManage),
  );

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-[760px] space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-[var(--ds-radius-tile)]" />
        <Skeleton className="h-48 w-full rounded-[var(--ds-radius-tile)]" />
      </div>
    );
  }
  if (query.error || !view) {
    const missing = query.error instanceof ServerFnError && query.error.status === 404;
    return missing ? (
      <EmptyState
        icon={Bot}
        title="Autopilot isn't switched on here"
        description="It hasn't been turned on for this workspace yet."
      />
    ) : (
      <ErrorState
        title="We couldn't load Autopilot"
        detail={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const handlers: AutopilotHandlers = {
    start: (settings) => actions.start.mutate(settings),
    update: (settings) => actions.update.mutate(settings),
    pause: (paused) => actions.pause.mutate(paused),
    stop: () => actions.stop.mutate(),
    approvePlan: () => actions.approvePlan.mutate(),
    decide: (actionId, decision) => actions.decide.mutate({ actionId, decision }),
    retry: (actionId) => actions.retry.mutate(actionId),
    opportunity: (args) => actions.opportunity.mutate(args),
    open: (target) => {
      // Each of these lives elsewhere in Mellox; Autopilot only sends people there.
      if (target === "calendar") navigate({ to: workspacePath(workspaceId, "", { calendar: 1 }) });
      else if (target === "accounts") emitAppEvent("open:settings", { section: "accounts" });
      else if (target === "website") emitAppEvent("open:settings", { section: "website" });
      else if (target === "brand") emitAppEvent("open:brand-dna");
      else if (target === "style") emitAppEvent("open:brand-dna", { tab: "look" });
      else emitAppEvent("open:ai-visibility");
    },
    busy: Object.values(actions).some((m) => m.isPending),
  };

  return (
    <AutopilotScreen
      key={view.program?.id ?? "setup"}
      view={view}
      handlers={handlers}
      suggestion={{
        data: suggestion.data,
        loading: suggestion.isLoading,
        failed: Boolean(suggestion.error),
      }}
    />
  );
}
