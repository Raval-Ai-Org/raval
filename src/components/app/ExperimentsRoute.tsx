"use client";

// Experiments (Proof Engine, ADR-0024) is a real route rendered as the shared
// modal surface over AppShell, like Backlinks and Competitors.
import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-server-fn";
import { getProofEngineStatus } from "@/lib/experiments.functions";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Trophy } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";

const ExperimentsPanel = lazy(() =>
  import("@/components/app/experiments/ExperimentsPanel").then((m) => ({
    default: m.ExperimentsPanel,
  })),
);

export default function ExperimentsRoute() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();
  const proofEngineStatus = useServerFn(getProofEngineStatus);
  // Same key as the sidebar, so this is usually already cached.
  const { data: status, isPending } = useQuery({
    queryKey: ["proof-engine-status", workspaceId],
    queryFn: () => proofEngineStatus({ data: { workspaceId: workspaceId as string } }),
    enabled: Boolean(workspaceId),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const home = workspaceId ? workspacePath(workspaceId) : "/projects";
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Experiments"
      Icon={Trophy}
      size="xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        {!workspaceId || isPending ? (
          <PageLoader />
        ) : status?.enabled !== false ? (
          <ExperimentsPanel workspaceId={workspaceId} />
        ) : (
          <EmptyState
            icon={Trophy}
            title="Experiments isn't on for this brand yet"
            description="It isn't switched on for this account yet. Everything else works as usual."
            action={<Button onClick={() => router.push(home)}>Back to chat</Button>}
          />
        )}
      </Suspense>
    </AppModalShell>
  );
}
