"use client";

// Campaigns (ADR-0039) is a real route rendered as the shared modal surface
// over AppShell, like Inspo. Where you are comes from the URL (?c=, ?v=new,
// ?type=, ?tab=), so every campaign and the designer can be linked to.
import { Suspense, lazy } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Megaphone } from "@/components/icons";
import { PageLoader } from "@/components/ui/page-loader";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import {
  CAMPAIGN_TABS,
  type CampaignsMode,
  type CampaignsTab,
} from "@/components/app/campaigns/types";
import { campaignsPath, workspacePath } from "@/lib/workspace/paths";

const CampaignsPanel = lazy(() =>
  import("@/components/app/campaigns/CampaignsPanel").then((m) => ({ default: m.CampaignsPanel })),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readMode(params: URLSearchParams): CampaignsMode {
  const c = params.get("c");
  const id = c && UUID.test(c) ? c : null;
  if (params.get("v") === "new") return { kind: "new", type: params.get("type"), editId: id };
  return id ? { kind: "campaign", id } : { kind: "home" };
}

function readTab(params: URLSearchParams): CampaignsTab {
  const t = params.get("tab");
  return (CAMPAIGN_TABS as readonly string[]).includes(t ?? "") ? (t as CampaignsTab) : "overview";
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = useOptionalWorkspaceId();
  const mode = readMode(params);
  const tab = readTab(params);
  return (
    <AppModalShell
      open
      onOpenChange={(next: boolean) => {
        if (!next) router.push(workspaceId ? workspacePath(workspaceId) : "/projects");
      }}
      title="Campaigns"
      Icon={Megaphone}
      size="2xl"
      allowMaximize
      bodyClassName="overflow-hidden"
    >
      <Suspense fallback={<PageLoader />}>
        {workspaceId ? (
          // Remount on switch, so no state from one brand survives into another.
          <CampaignsPanel
            key={workspaceId}
            workspaceId={workspaceId}
            mode={mode}
            tab={tab}
            onTab={(next) =>
              router.replace(campaignsPath(workspaceId, { tab: next }), { scroll: false })
            }
            onMode={(next) =>
              router.push(
                next.kind === "new"
                  ? campaignsPath(workspaceId, { v: "new", type: next.type, c: next.editId })
                  : next.kind === "campaign"
                    ? campaignsPath(workspaceId, { c: next.id })
                    : campaignsPath(workspaceId, { tab }),
                { scroll: false },
              )
            }
          />
        ) : (
          <PageLoader />
        )}
      </Suspense>
    </AppModalShell>
  );
}

export default function CampaignsRoute() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
