"use client";

import { useState } from "react";
import { ProductStep } from "@/components/app/ugc/ProductStep";
import { BriefStep } from "@/components/app/ugc/BriefStep";
import { ConceptsStep } from "@/components/app/ugc/ConceptsStep";
import { ScriptStep } from "@/components/app/ugc/ScriptStep";
import { GenerateStep, type RenderSettingsState } from "@/components/app/ugc/GenerateStep";
import { RenderPanel } from "@/components/app/ugc/RenderPanel";
import { ScanBar } from "@/components/app/geo/ScanControls";
import type { GeoScanMode } from "@/lib/geo/contracts";
import { AgentManageDialog } from "@/components/agents/AgentManageDialog";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { agents } from "@/lib/agents";
import { BriefSchema, ProductSchema, ScriptSchema, type ModelView } from "@/lib/ugc/schemas";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const product = ProductSchema.parse({
  name: "Northwind daily moisturiser for sensitive and dry skin",
  brand: "Northwind",
  url: "https://northwind.example/products/moisturiser",
  description: "A light moisturiser for dry skin, without fragrance.",
  benefits: ["Hydrates dry skin", "No fragrance"],
  facts: [{ id: "fact-1", text: "Made without fragrance", type: "feature", source: "user" }],
});
const brief = BriefSchema.parse({
  audience: "People with dry, sensitive skin who want a simple daily routine",
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
  const [settings, setSettings] = useState<RenderSettingsState>({
    model: "standard",
    durationSec: 10,
    aspectRatio: "9:16",
    resolution: "720p",
    referenceIds: [],
  });
  const [url, setUrl] = useState("https://northwind.example/international/marketing");
  const [mode, setMode] = useState<GeoScanMode>("full");
  const [probes, setProbes] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  return (
    <WorkspaceProvider workspaceId={WORKSPACE}>
      <div data-testid="module-states" className="mx-auto w-full max-w-[1100px] space-y-5 p-4">
        {scene === "ugc-product" && (
          <ProductStep
            workspaceId={WORKSPACE}
            initialProduct={product}
            initialReferences={[]}
            saving={false}
            onContinue={() => {}}
          />
        )}
        {scene === "ugc-empty" && (
          <ProductStep
            workspaceId={WORKSPACE}
            initialProduct={null}
            initialReferences={[]}
            saving={false}
            onContinue={() => {}}
          />
        )}
        {scene === "ugc-brief" && (
          <BriefStep
            workspaceId={WORKSPACE}
            projectId={WORKSPACE}
            initialBrief={brief}
            product={product}
            hasConcepts
            busy={false}
            durationSec={10}
            onDurationChange={() => {}}
            onBack={() => {}}
            onGenerate={() => {}}
            onSkipToConcepts={() => {}}
          />
        )}
        {scene === "ugc-concepts" && (
          <ConceptsStep
            concepts={[
              {
                id: "one",
                title: "An uncomplicated routine for dry and sensitive skin",
                angle: "Keep it simple",
                format: "problem_solution",
                hooks: [script.hook, "One small change for your morning routine"],
                whyItWorks: "Answers a practical concern with one clear benefit.",
                script,
                warnings: [],
              },
            ]}
            selectedConceptId="one"
            busy={false}
            onBack={() => {}}
            onRegenerate={() => {}}
            onChoose={() => {}}
          />
        )}
        {scene === "ugc-script" && (
          <ScriptStep
            initialScript={script}
            product={product}
            brief={brief}
            durationSec={10}
            aspectRatio="9:16"
            rewriting={false}
            saving={false}
            onBack={() => {}}
            onRewrite={() => {}}
            onContinue={() => {}}
          />
        )}
        {(scene === "ugc-generate" || scene === "ugc-blocked") && (
          <GenerateStep
            models={[model]}
            allowance={{
              plan: "starter",
              videos: { used: scene === "ugc-blocked" ? 10 : 0, held: 0, limit: 10 },
              activeRenders: 0,
              maxConcurrent: 1,
            }}
            loadingModels={false}
            settings={settings}
            references={[]}
            hook={script.hook}
            generating={false}
            onChange={setSettings}
            onBack={() => {}}
            onGenerate={() => {}}
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
