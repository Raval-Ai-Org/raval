"use client";

// Communities (sidebar → Grow → Communities): the threads where people ask
// about what the brand does, on Reddit, Quora, Hacker News and Stack Exchange.
// Its own route so it's one click away; Brain → Market links here too.
import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { MessageCircle } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";

const CommunityPanel = lazy(() =>
  import("@/components/app/brain/community/CommunityPanel").then((m) => ({
    default: m.CommunityPanel,
  })),
);

function Inner() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Communities"
      Icon={MessageCircle}
      size="2xl"
      bodyClassName="overflow-y-auto"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? (
          <SurfacePage width="wide">
            <div className="ds-enter">
              {/* Remount on switch, so no state from one brand survives into another. */}
              <CommunityPanel key={workspaceId} workspaceId={workspaceId} />
            </div>
          </SurfacePage>
        ) : (
          <PageLoader />
        )}
      </Suspense>
    </AppModalShell>
  );
}

export default function CommunitiesRoute() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
