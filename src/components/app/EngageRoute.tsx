"use client";

// Inbox (Engage): comments on the brand's own Instagram and Facebook posts,
// answered by a person. Its own route so it's one link away.
import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { Inbox } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";
import { leaveRoute } from "@/lib/shell/history";

const EngagePanel = lazy(() =>
  import("@/components/app/engage/EngagePanel").then((m) => ({ default: m.EngagePanel })),
);

function Inner() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();
  return (
    <AppModalShell
      routed
      open
      onOpenChange={(next: boolean) => {
        if (!next) leaveRoute(router, workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Inbox"
      Icon={Inbox}
      size="2xl"
      bodyClassName="overflow-y-auto"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? (
          <SurfacePage width="wide">
            <div className="ds-enter">
              {/* Remount on switch, so no state from one brand survives into another. */}
              <EngagePanel key={workspaceId} workspaceId={workspaceId} />
            </div>
          </SurfacePage>
        ) : (
          <PageLoader />
        )}
      </Suspense>
    </AppModalShell>
  );
}

export default function EngageRoute() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
