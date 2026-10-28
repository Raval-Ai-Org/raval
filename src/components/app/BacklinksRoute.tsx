"use client";

// Backlink Growth is a real route, but AppShell owns the viewport on
// /w/<id>/app/*. So the page renders the shared modal surface over it, with
// `open` pinned and closing mapped to navigation. That gives a real URL, real
// metadata, working back/forward and deep links, while reusing the surface
// every other Mellox feature uses — no second layout system.
//
// Backlinks is paused while it is reworked: old links, chat offers and the
// agency view still land here, and see "coming soon" instead of the panel.
// `LinksPanel` and its server side are untouched; render it again to bring it back.
import { useRouter } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Link2 } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";

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
      title="Backlinks"
      Icon={Link2}
      size="sm"
    >
      <EmptyState
        icon={Link2}
        title="Coming soon"
        description="We're reworking Backlinks. It will be back here when it's ready."
      />
    </AppModalShell>
  );
}
