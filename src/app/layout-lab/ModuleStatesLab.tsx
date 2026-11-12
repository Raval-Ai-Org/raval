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
import { StoryboardView } from "@/components/studio/storyboard/StoryboardView";
import { boardFromCreatorScript } from "@/lib/studio/video/board";

// ugc-storyboard: a 20 s Creator video's plan, shown before it is made.
const longScript = ScriptSchema.parse({
  hook: "I stopped using five products and my skin finally calmed down.",
  onScreen: "5 products → 1",
  scenes: [
    {
      id: "s1",
      start: 0,
      end: 4,
      shot: "Selfie, arm's length",
      action: "Holds up a crowded shelf of bottles, then pushes them aside",
      dialogue: "I stopped using five products.",
      caption: "",
    },
    {
      id: "s2",
      start: 4,
      end: 9,
      shot: "Close-up of the bottle",
      action: "Turns the Northwind bottle to the camera",
      dialogue: "This one is made without fragrance, so nothing stings.",
      caption: "No fragrance",
    },
    {
      id: "s3",
      start: 9,
      end: 15,
      shot: "Mirror, medium shot",
      action: "Applies a small amount to her cheek in the bathroom mirror",
      dialogue: "One pump, morning and night. That's it.",
      caption: "",
    },
    {
      id: "s4",
      start: 15,
      end: 20,
      shot: "Selfie, close",
      action: "Smiles at the camera, bottle beside her face",
      dialogue: "See the moisturiser, link below.",
      caption: "Link below",
    },
  ],
  cta: "See the moisturiser",
  postCaption: "One product instead of five.",
  factIds: ["fact-1"],
});
const longBoard = boardFromCreatorScript(longScript);

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
    // ugc-formats: the format grid; ugc-create: a two-person format.
    format: scene === "ugc-formats" ? null : scene === "ugc-create" ? "subway-interview" : "auto",
    partnerId: null,
    hookOn: true,
    hookPreset: null,
    hookLine: scene === "ugc-create" ? "she ended him in 9 seconds" : "",
  });
  const [url, setUrl] = useState("https://northwind.example/international/marketing");
  const [mode, setMode] = useState<GeoScanMode>("full");
  const [probes, setProbes] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  return (
    // The Creator composer scenes are presentational and need no workspace.
    <LabWorkspace
      bare={
        scene === "ugc-storyboard" ||
        scene === "ugc-create" ||
        scene === "ugc-empty" ||
        scene === "ugc-formats"
      }
    >
      <div data-testid="module-states" className="mx-auto w-full max-w-[1100px] space-y-5 p-4">
        {scene === "ugc-storyboard" && (
          <StoryboardView
            board={longBoard}
            frames={Object.fromEntries(
              longBoard.scenes
                .filter((sc) => sc.frameSlot)
                .map((sc, i) => [
                  sc.frameSlot!,
                  i === 3
                    ? { status: "pending" as const }
                    : {
                        status: "ready" as const,
                        url: ["/creators/maya.jpg", "/creators/elena.jpg", "/creators/amara.jpg"][
                          i % 3
                        ],
                      },
                ]),
            )}
            ratio="9 / 16"
            meta={["Maya", "Northwind moisturiser", "Talking to camera"]}
            createLabel="Create video · 20s"
            onCreate={() => {}}
            onChange={() => {}}
            changeLabel="Change the script"
            note="Uses 1 of your 4 videos left, only when you press Create."
          />
        )}
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
        {(scene === "ugc-create" || scene === "ugc-empty" || scene === "ugc-formats") && (
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
            conceptPrice={25}
            videosLeft={8}
            busy={null}
            onWrite={() => {}}
            onGenerate={() => {}}
            onToggleBrandCreator={() => {}}
            onAddProducts={() => {}}
            onAddPeople={() => {}}
            creatorPrice={15}
            onCreateCreator={async () => false}
            formatSuggested={
              scene === "ugc-empty"
                ? []
                : ["honest-review", "grwm", "mirror-routine", "subway-interview", "storytime"]
            }
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
    </LabWorkspace>
  );
}

function LabWorkspace({ bare, children }: { bare: boolean; children: React.ReactNode }) {
  return bare ? (
    <>{children}</>
  ) : (
    <WorkspaceProvider workspaceId={WORKSPACE}>{children}</WorkspaceProvider>
  );
}
