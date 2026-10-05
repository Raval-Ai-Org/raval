"use client";

// Audience for one workspace: loads the view, wires what a person does to the
// server, and hands both to AudienceScreen.
import { Users } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { emitAppEvent } from "@/lib/app-events";
import { ServerFnError } from "@/lib/rpc-client";
import { AudienceScreen, type AudienceHandlers } from "./AudienceScreen";
import { useAudience, useAudienceActions } from "./hooks";

export function AudiencePanel({ workspaceId }: { workspaceId: string }) {
  const query = useAudience(workspaceId);
  const actions = useAudienceActions(workspaceId);
  const view = query.data;

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-[760px] space-y-3 p-6">
        <Skeleton className="h-24 w-full rounded-[var(--ds-radius-tile)]" />
        <Skeleton className="h-48 w-full rounded-[var(--ds-radius-tile)]" />
        <Skeleton className="h-48 w-full rounded-[var(--ds-radius-tile)]" />
      </div>
    );
  }
  if (query.error || !view) {
    const missing = query.error instanceof ServerFnError && query.error.status === 404;
    return missing ? (
      <EmptyState
        icon={Users}
        title="Audience isn't switched on here"
        description="It hasn't been turned on for this workspace yet."
      />
    ) : (
      <ErrorState
        title="We couldn't load your audience"
        detail={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const handlers: AudienceHandlers = {
    build: () => actions.build.mutate(),
    saveGroup: (id, group) => actions.saveGroup.mutate({ id, group }),
    removeGroup: (id) => actions.removeGroup.mutate(id),
    cancelBuild: (runId) => actions.cancel.mutate(runId),
    // Customers live in Brand DNA; Audience only sends people there.
    openBrandDna: () => emitAppEvent("open:brand-dna", { tab: "customers" }),
    busy:
      actions.build.isPending ||
      actions.saveGroup.isPending ||
      actions.removeGroup.isPending ||
      actions.cancel.isPending,
  };

  return <AudienceScreen view={view} handlers={handlers} />;
}
