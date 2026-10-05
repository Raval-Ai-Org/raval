"use client";
// Strategy for one workspace: loads the view, wires what a person does to the
// server, and hands both to StrategyScreen.
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrainId } from "@/lib/brain/brain";
import { useStrategy, useStrategyActions } from "../use-brain";
import { StrategyScreen, type StrategyHandlers } from "./StrategyScreen";

export function StrategyPanel({
  workspaceId,
  onOpenBrain,
}: {
  workspaceId: string;
  onOpenBrain: (brain: BrainId) => void;
}) {
  const query = useStrategy(workspaceId);
  const actions = useStrategyActions(workspaceId);
  const view = query.data;

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-3 p-6">
        <Skeleton className="h-40 w-full rounded-[var(--ds-radius-tile)]" />
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-44 rounded-[var(--ds-radius-tile)]" />
          <Skeleton className="h-44 rounded-[var(--ds-radius-tile)] lg:col-span-2" />
        </div>
      </div>
    );
  }
  if (query.error || !view) {
    return (
      <div className="p-6">
        <ErrorState
          title="We couldn't load your strategy"
          detail={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const handlers: StrategyHandlers = {
    generate: (note) => actions.generate.mutate(note),
    save: (strategy, confirm) => actions.save.mutate({ strategy, version: view.version, confirm }),
    openBrain: onOpenBrain,
    generating: actions.generate.isPending,
    saving: actions.save.isPending,
  };
  return <StrategyScreen view={view} handlers={handlers} />;
}
