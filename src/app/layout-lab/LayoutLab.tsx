"use client";

import { useEffect, useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { ShareDialog } from "@/components/app/ShareDialog";
import { PublishDialog } from "@/components/app/PublishDialog";
import { ContentItemDialog } from "@/components/studio/ContentItemDialog";
import { BrainShell } from "@/components/app/brain/BrainShell";
import { BrainIcon } from "@/components/app/brain/BrainMark";
import { FreeSidebarCardView } from "@/components/app/billing/FreePlanPushes";
import { Button } from "@/components/ui/button";
import type { BrainSection } from "@/lib/brain/brain";
import { ControlStressLab } from "./ControlStressLab";
import { ModuleStatesLab } from "./ModuleStatesLab";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";

export function LayoutLab() {
  const [scene, setScene] = useState<string | null>(null);
  const [section, setSection] = useState<BrainSection>("home");
  const [tab, setTab] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [publishWorkspace, setPublishWorkspace] = useState(WORKSPACE);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setScene(params.get("scene") ?? "share");
    if (params.get("scene") === "competitors") setSection("competitors");
  }, []);

  return (
    <div data-mellox-app data-testid="layout-lab" data-ready={scene !== null} className="p-4">
      {scene === "controls" && <ControlStressLab />}
      {scene === "publish" && (
        <>
          <Button
            data-testid="switch-publish-brand"
            onClick={() => setPublishWorkspace("00000000-0000-4000-8000-000000000003")}
          >
            Switch brand
          </Button>
          <PublishDialog workspaceId={publishWorkspace}>
            <Button>Open publish</Button>
          </PublishDialog>
          <ContentItemDialog />
        </>
      )}
      {scene && (scene.startsWith("ugc-") || scene === "geo-scan" || scene === "agent") && (
        <ModuleStatesLab scene={scene} />
      )}
      {scene === "share" && (
        <ShareDialog workspaceId={WORKSPACE}>
          <Button>Share with team</Button>
        </ShareDialog>
      )}
      {(scene === "brain" || scene === "competitors") && (
        <AppModalShell
          open={open}
          onOpenChange={setOpen}
          title="Brain"
          Icon={BrainIcon}
          size="2xl"
          bodyClassName="overflow-hidden"
        >
          <BrainShell
            workspaceId={WORKSPACE}
            section={section}
            tab={tab}
            onNavigate={(next, nextTab) => {
              setSection(next);
              setTab(nextTab ?? null);
            }}
          />
        </AppModalShell>
      )}
      {scene === "credits" && (
        <div className="w-[216px] max-w-full">
          <FreeSidebarCardView credits={125000} nudge={null} onUpgrade={() => {}} />
        </div>
      )}
    </div>
  );
}
