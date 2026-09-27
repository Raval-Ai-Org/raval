"use client";

import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Users } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";

const CompetitorsPanel = lazy(() =>
  import("@/components/app/competitors/CompetitorsPanel").then((m) => ({
    default: m.CompetitorsPanel,
  })),
);

export default function CompetitorsRoute() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();

  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Competitors"
      Icon={Users}
      size="xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        <CompetitorsPanel workspaceId={workspaceId} />
      </Suspense>
    </AppModalShell>
  );
}
