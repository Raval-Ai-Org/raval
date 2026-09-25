"use client";

// Brand Kit is a real route rendered as the shared modal surface over
// AppShell, like Backlinks, Competitors and Experiments. ?style=<id> opens a
// style, ?section=<id> a library page, ?create=1 the new-style flow.
import { Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { BrandKit } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { workspacePath, isWorkspaceId } from "@/lib/workspace/paths";

const BrandKitPanel = lazy(() =>
  import("@/components/app/brand-kit/BrandKitPanel").then((m) => ({ default: m.BrandKitPanel })),
);

export default function BrandKitRoute() {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = useOptionalWorkspaceId();
  const style = params.get("style");
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Brand Kit"
      Icon={BrandKit}
      size="2xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? (
          <BrandKitPanel
            workspaceId={workspaceId}
            initialStyleId={style && isWorkspaceId(style) ? style : null}
            initialSection={params.get("section")}
            startCreate={params.get("create") === "1"}
          />
        ) : (
          <PageLoader />
        )}
      </Suspense>
    </AppModalShell>
  );
}
