"use client";

import { useState } from "react";
import { CreatorComposer, type CreatorDraft } from "@/components/app/ugc/CreatorComposer";
import { STOCK_CREATORS, creatorsInOrder, suggestCreators } from "@/lib/ugc/creators";
import { RenderPanel } from "@/components/app/ugc/RenderPanel";
import { UgcStudio } from "@/components/app/ugc/UgcStudio";
import { ScanBar } from "@/components/app/geo/ScanControls";
import type { GeoScanMode } from "@/lib/geo/contracts";
import { AgentManageDialog } from "@/components/agents/AgentManageDialog";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { agents } from "@/lib/agents";
import { ProductSchema, ScriptSchema, type ModelView } from "@/lib/ugc/schemas";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const product = ProductSchema.parse({
  name: "Northwind daily moisturiser for sensitive and dry skin",
  brand: "Northwind",
  url: "https://northwind.example/products/moisturiser",
  description: "A light moisturiser for dry skin, without fragrance.",
  benefits: ["Hydrates dry skin", "No fragrance"],
  facts: [{ id: "fact-1", text: "Made without fragrance", type: "feature", source: "user" }],
});
const script = ScriptSchema.parse({
  hook: "Your skin care routine doesn't need to be complicated.",
  scenes: [
    {
      id: "one",
      start: 0,
      end: 5,
      dialogue: "One moisturiser, made without fragrance.",
      action: "Apply a small amount to your hand",
      shot: "Close-up of the bottle",
    },
  ],
  cta: "See the moisturiser",
  postCaption: "A simpler daily routine for sensitive skin.",
  factIds: ["fact-1"],
});
const model: ModelView = {
  key: "standard",
  displayName: "Standard video with native audio and product references",
  tier: "standard",
  description: "Product details and a clear creator voice.",
  durations: [5, 10, 15],
  imageDurations: [5, 10],
  aspectRatios: ["9:16", "1:1", "16:9"],
  resolutions: ["720p", "1080p"],
  defaultResolution: "720p",
  nativeAudio: true,
  images: { mode: "references", max: 3 },
  videoUnits: 1,
};

export function ModuleStatesLab({ scene }: { scene: string }) {
  const [draft, setDraft] = useState<CreatorDraft>({
    creator: scene === "ugc-create" ? { kind: "stock", id: "maya" } : null,
    productKey: scene === "ugc-create" ? "moisturiser" : null,
    scriptText:
      scene === "ugc-create"
        ? `${script.hook}
${script.scenes[0].dialogue}`
        : "",
    tone: "authentic",
    setting: "auto",
    platform: "tiktok",
    durationSec: 10,
  });
  const [url, setUrl] = useState("https://northwind.example/international/marketing");
  const [mode, setMode] = useState<GeoScanMode>("full");
  const [probes, setProbes] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  return (
    <WorkspaceProvider workspaceId={WORKSPACE}>
      <div data-testid="module-states" className="mx-auto w-full max-w-[1100px] space-y-5 p-4">
        {scene === "ugc-script-video" && (
          <UgcStudio
            workspaceId={WORKSPACE}
            source={{
              workspaceId: WORKSPACE,
              platforms: ["instagram"],
              script: {
                title: "A simpler daily routine",
                hook: "Keep your routine simple.",
                beats: [
                  {
                    time: "0–5s",
                    visual: "Hold the product beside the creator",
                    voiceover: "Keep your routine simple.",
                  },
                  {
                    time: "5–10s",
                    visual: "Show the product in use",
                    voiceover: "See the moisturiser today.",
                  },
                ],
                cta: "See the moisturiser today.",
                caption: "Your daily routine.",
                durationSec: 10,
              },
            }}
          />
        )}
        {(scene === "ugc-create" || scene === "ugc-empty") && (
          <CreatorComposer
            draft={draft}
            onDraft={(p) => setDraft((d) => ({ ...d, ...p }))}
            creators={creatorsInOrder(STOCK_CREATORS)}
            suggested={
              scene === "ugc-empty"
                ? []
                : suggestCreators({ industry: "Skincare", audience: "Women 25-34 with dry skin" })
            }
            people={[]}
            brandCreator={scene === "ugc-create" ? { id: "maya" } : null}
            products={
              scene === "ugc-empty"
                ? []
                : [
                    {
                      key: "moisturiser",
                      name: "Daily moisturiser",
                      imageUrl: null,
                      product,
                      references: [],
                    },
                  ]
            }
            durations={[5, 10, 15]}
            ideas={[]}
            conceptPrice={25}
            videosLeft={8}
            busy={null}
            onWrite={() => {}}
            onPickIdea={() => {}}
            onGenerate={() => {}}
            onToggleBrandCreator={() => {}}
            onAddProducts={() => {}}
            onAddPeople={() => {}}
            creatorPrice={15}
            onCreateCreator={async () => false}
          />
        )}
        {scene === "ugc-failed" && (
          <RenderPanel
            workspaceId={WORKSPACE}
            render={{
              id: WORKSPACE,
              projectId: WORKSPACE,
              status: "failed",
              model: "standard",
              modelName: model.displayName,
              durationSec: 10,
              aspectRatio: "9:16",
              resolution: "720p",
              hook: script.hook,
              errorMessage:
                "The provider could not finish this video. Your video allowance was returned.",
              allowanceReturned: true,
              assetId: null,
              videoUrl: null,
              createdAt: "2026-10-14T00:00:00Z",
              submittedAt: null,
              completedAt: null,
            }}
            script={script}
            history={[]}
            onSettled={() => {}}
            onRegenerate={() => {}}
            onEditSettings={() => {}}
            onSelectRender={() => {}}
            regenerating={false}
          />
        )}
        {scene === "geo-scan" && (
          <ScanBar
            url={url}
            onUrlChange={setUrl}
            mode={mode}
            onModeChange={setMode}
            maxPages={100}
            probesAvailable
            probes={probes}
            onProbesChange={setProbes}
            busy={false}
            starting={false}
            canRescan
            onRun={() => {}}
            hint="The first scan is included. Your latest report stays available while we scan."
          />
        )}
        {scene === "agent" && (
          <AgentManageDialog agent={agents.scout} open={agentOpen} onOpenChange={setAgentOpen} />
        )}
      </div>
    </WorkspaceProvider>
  );
}
