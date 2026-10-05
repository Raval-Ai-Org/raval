"use client";

// Audience (ADR-0031) is a real route rendered as the shared modal surface
// over AppShell, like Autopilot and Competitors.
import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Users } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";

const AudiencePanel = lazy(() =>
  import("@/components/app/audience/AudiencePanel").then((m) => ({
    default: m.AudiencePanel,
  })),
);

export default function AudienceRoute() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Audience"
      Icon={Users}
      size="xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? <AudiencePanel workspaceId={workspaceId} /> : <PageLoader />}
      </Suspense>
    </AppModalShell>
  );
}
