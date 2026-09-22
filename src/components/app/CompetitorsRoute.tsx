"use client";

// Competitors is a real route, but AppShell owns the viewport on
// /w/<id>/app/*. So the page renders the shared modal surface over it, with
// `open` pinned and closing mapped to navigation — the same arrangement
// Backlink Growth uses. Real URL, real metadata, working back/forward and
// deep links, and no second layout system.
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
      description="Who you're up against, what they do, and what changed."
      eyebrow="Intelligence"
      Icon={Users}
      size="xl"
    >
      <Suspense fallback={<PageLoader />}>
        <CompetitorsPanel workspaceId={workspaceId} />
      </Suspense>
    </AppModalShell>
  );
}
