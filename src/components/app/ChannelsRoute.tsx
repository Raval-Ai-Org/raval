"use client";

// Channels is a real route rendered as the shared modal surface over AppShell,
// like Inspo. The section comes from the URL (?s=…), so each part can be linked to.
import { Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Megaphone } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { parseChannelSection } from "@/lib/channels/sections";
import { channelsPath, workspacePath } from "@/lib/workspace/paths";

const ChannelsPanel = lazy(() =>
  import("@/components/app/channels/ChannelsPanel").then((m) => ({ default: m.ChannelsPanel })),
);

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = useOptionalWorkspaceId();
  const section = parseChannelSection(params.get("s"));
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Channels"
      Icon={Megaphone}
      size="2xl"
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? (
          // Remount on switch, so no state from one brand survives into another.
          <ChannelsPanel
            key={workspaceId}
            workspaceId={workspaceId}
            section={section}
            onSection={(next) => router.replace(channelsPath(workspaceId, next), { scroll: false })}
          />
        ) : (
          <PageLoader />
        )}
      </Suspense>
    </AppModalShell>
  );
}

export default function ChannelsRoute() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
