"use client";

// Backlink Growth is a real route, but AppShell owns the viewport on
// /w/<id>/app/*. So the page renders the shared modal surface over it, with
// `open` pinned and closing mapped to navigation. That gives a real URL, real
// metadata, working back/forward and deep links, while reusing the surface
// every other Mellox feature uses — no second layout system.
import { Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Link2 } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";

const LinksPanel = lazy(() =>
  import("@/components/app/links/LinksPanel").then((m) => ({ default: m.LinksPanel })),
);

export default function BacklinksRoute() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();

  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        // Closing leaves the route rather than hiding a page that is still the
        // current URL.
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Backlink Growth"
      Icon={Link2}
      size="xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        <LinksPanel workspaceId={workspaceId} />
      </Suspense>
    </AppModalShell>
  );
}
