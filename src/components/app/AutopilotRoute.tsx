"use client";

// Autopilot (ADR-0028) is a real route rendered as the shared modal surface
// over AppShell, like Experiments and Backlinks.
import { Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

const SECTIONS = ["home", "approvals", "ideas", "activity", "settings"] as const;

export default function AutopilotRoute() {
  const router = useRouter();
  // The message box and the top bar link straight to a section with ?s=.
  const wanted = useSearchParams().get("s");
  const section = SECTIONS.find((s) => s === wanted);
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
        {workspaceId ? (
          <AutopilotPanel workspaceId={workspaceId} initialSection={section} />
        ) : (
          <PageLoader />
        )}
      </Suspense>
    </AppModalShell>
  );
}
