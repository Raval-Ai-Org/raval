"use client";

// Brain (ADR-0032) is a real route rendered as the shared modal surface over
// AppShell, like Autopilot. The section and the place inside it come from the
// URL (?s=…&t=…), so every part of Brain can be linked to.
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { BrainIcon } from "@/components/app/brain/BrainMark";
import { BrainShell } from "@/components/app/brain/BrainShell";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { isBrainSection, type BrainSection } from "@/lib/brain/brain";
import { brainPath, inspoPath, workspacePath } from "@/lib/workspace/paths";

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = useOptionalWorkspaceId();
  const raw = params.get("s");
  const section: BrainSection = isBrainSection(raw) ? raw : "home";
  const tab = params.get("t");
  // Look & voice and Assets moved to Inspo (ADR-0037); old links land there.
  const movedTo = section === "brand" && (tab === "look" || tab === "assets") ? tab : null;
  useEffect(() => {
    if (workspaceId && movedTo) router.replace(inspoPath(workspaceId, movedTo));
  }, [workspaceId, movedTo, router]);

  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Brain"
      Icon={BrainIcon}
      size="2xl"
      bodyClassName="overflow-hidden"
    >
      {workspaceId ? (
        // Remount on switch, so no state from one brand ever survives into another.
        <BrainShell
          key={workspaceId}
          workspaceId={workspaceId}
          section={section}
          tab={tab}
          onNavigate={(next, nextTab) =>
            router.replace(brainPath(workspaceId, next, nextTab), { scroll: false })
          }
        />
      ) : (
        <PageLoader />
      )}
    </AppModalShell>
  );
}

export default function BrainRoute() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
