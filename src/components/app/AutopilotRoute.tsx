"use client";

// Autopilot (ADR-0028) is a real route rendered as the shared modal surface
// over AppShell, like Experiments and Backlinks.
import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Bot } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";

const AutopilotPanel = lazy(() =>
  import("@/components/app/autopilot/AutopilotPanel").then((m) => ({
    default: m.AutopilotPanel,
  })),
);

export default function AutopilotRoute() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Autopilot"
      Icon={Bot}
      size="xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? <AutopilotPanel workspaceId={workspaceId} /> : <PageLoader />}
      </Suspense>
    </AppModalShell>
  );
}
