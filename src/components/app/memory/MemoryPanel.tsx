"use client";

// Settings → Memory, wired to the server (src/server/fns/memory.ts).
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { MemoryScreen } from "./MemoryScreen";
import { useMemory, useMemoryActions } from "./use-memory";

export function MemoryPanel({ workspaceId }: { workspaceId: string }) {
  const memory = useMemory(workspaceId);
  const actions = useMemoryActions(workspaceId);

  if (memory.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-[20px]" />
        <Skeleton className="h-40 w-full rounded-[20px]" />
      </div>
    );
  }
  if (memory.isError || !memory.data) {
    return (
      <ErrorState
        size="sm"
        title="Memory isn't available"
        detail={memory.error instanceof Error ? memory.error.message : "Try again in a moment."}
        onRetry={() => memory.refetch()}
      />
    );
  }

  return (
    <MemoryScreen
      view={memory.data}
      busy={actions.busy}
      handlers={{
        setEnabled: (enabled) => actions.setEnabled.mutate(enabled),
        add: (body, hours) => actions.add.mutate({ body, hours }),
        edit: (id, body) => actions.edit.mutate({ id, body }),
        keep: (id) => actions.edit.mutate({ id, hours: null }),
        remove: (id) => actions.remove.mutate(id),
        clear: () => actions.clear.mutate(),
      }}
    />
  );
}
