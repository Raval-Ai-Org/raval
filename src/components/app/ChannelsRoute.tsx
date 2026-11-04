"use client";

// Channels is a real route rendered as the shared modal surface over AppShell,
// like Inspo. The section comes from the URL (?s=…), so each part can be linked to.
import { Suspense, lazy, useEffect } from "react";
import { emitAppEvent } from "@/lib/app-events";
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

/**
 * Channels moved into Settings (Social accounts and Connectors). Old links
 * land on the workspace with the matching Settings section open.
 */
function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = useOptionalWorkspaceId();
  const section = parseChannelSection(params.get("s"));
  useEffect(() => {
    if (!workspaceId) return;
    router.replace(workspacePath(workspaceId));
    const target =
      section === "social"
        ? { section: "accounts" as const }
        : section === "analytics"
          ? { section: "connectors" as const, connector: "google" }
          : { section: "connectors" as const };
    // Settings mounts with the shell; give it a moment to listen.
    const t = window.setTimeout(() => emitAppEvent("open:settings", target), 150);
    return () => window.clearTimeout(t);
  }, [router, section, workspaceId]);
  if (workspaceId) return <PageLoader />;
  return (
    <AppModalShell
      routed
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
