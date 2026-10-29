"use client";

// Inspo (ADR-0037) is a real route rendered as the shared modal surface over
// AppShell, like Brain. The section comes from the URL (?s=…), so every part
// of Inspo can be linked to.
import { Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Palette } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { parseInspoSection } from "@/lib/inspo/sections";
import { inspoPath, workspacePath } from "@/lib/workspace/paths";

const InspoPanel = lazy(() =>
  import("@/components/app/inspo/InspoPanel").then((m) => ({ default: m.InspoPanel })),
);

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = useOptionalWorkspaceId();
  const section = parseInspoSection(params.get("s"));
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Inspo"
      Icon={Palette}
      size="2xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? (
          // Remount on switch, so no state from one brand survives into another.
          <InspoPanel
            key={workspaceId}
            workspaceId={workspaceId}
            section={section}
            onSection={(next) => router.replace(inspoPath(workspaceId, next), { scroll: false })}
          />
        ) : (
          <PageLoader />
        )}
      </Suspense>
    </AppModalShell>
  );
}

export default function InspoRoute() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
