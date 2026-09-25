"use client";

// Experiments (Proof Engine, ADR-0024) is a real route rendered as the shared
// modal surface over AppShell, like Backlinks and Competitors.
import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
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
        {workspaceId ? <ExperimentsPanel workspaceId={workspaceId} /> : <PageLoader />}
      </Suspense>
    </AppModalShell>
  );
}
