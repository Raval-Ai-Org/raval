"use client";
// Development-only visual QA for Brand Kit styles.
//
// Renders the "new style" screens and the colour picker with sample data, so
// the design can be checked without a workspace or a sign-in. Everything here
// is invented; saving is switched off.
import * as React from "react";
import type { BrandKitOverview, KitAssetView } from "@/lib/brand-kit/contracts";
import { ANALYSIS_VERSION, applySuggestion, mergeAnalyses } from "@/lib/brand-kit/merge";
import { emptySpec, type StyleSpec } from "@/lib/brand-kit/spec";
import { CreateStyleFlow, FinishStep } from "./CreateStyleFlow";
import { StylesGallery } from "./BrandKitPanel";
import { StyleEditor } from "./StyleEditor";

const post = (bg: string, main: string, text: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="150" cy="60" r="56" fill="${main}"/><rect x="20" y="130" width="120" height="14" rx="7" fill="${text}"/><rect x="20" y="154" width="80" height="10" rx="5" fill="${text}" opacity=".6"/></svg>`,
  )}`;

const EXAMPLES: Array<[string, string, string, string]> = [
  ["a1111111-1111-4111-8111-111111111111", "#0b1d3a", "#ffb400", "#ffffff"],
  ["a2222222-2222-4222-8222-222222222222", "#0c1e3b", "#ffb300", "#fefefe"],
  ["a3333333-3333-4333-8333-333333333333", "#0b1d3a", "#22c55e", "#ffffff"],
];

const ASSETS: KitAssetView[] = EXAMPLES.map(([id, bg, main, text]) => ({
  id,
  styleId: null,
  kind: "inspiration_image",
  label: null,
  tags: [],
  url: post(bg, main, text),
  frameUrls: [],
  textContent: null,
  sourceUrl: null,
  mime: "image/svg+xml",
  bytes: null,
  width: 200,
  height: 200,
  analysisStatus: "done",
  analysisError: null,
  analysis: {
    kind: "visual",
    v: ANALYSIS_VERSION,
    colors: [bg, main, text],
    roles: { background: bg, primary: main, text },
    visual: {
      medium: "flat",
      mood: "bold and energetic, high contrast, confident",
      composition: "big circle top right, headline bottom left",
      background: "solid navy",
      textPlacement: "bottom",
      typography: { heading: "Poppins", body: "Inter" },
      elements: ["big circles", "rounded bars"],
    },
  },
  stale: false,
  createdAt: "",
}));

const STYLE_ID = "b1111111-1111-4111-8111-111111111111";

const DATA: BrandKitOverview = {
  styles: [],
  assets: ASSETS,
  defaultStyleId: null,
  dna: {
    hasDna: true,
    brandName: "Acme",
    voice: "Warm and direct",
    colors: [
      { name: "Primary", hex: "#c6e052" },
      { name: "Ink", hex: "#111418" },
      { name: "Sky", hex: "#3399ff" },
    ],
    fonts: ["Poppins", "Inter"],
    logoUrl: null,
  },
  canEdit: true,
};

const SUGGESTION = (() => {
  const s = mergeAnalyses(ASSETS.map((a) => a.analysis!));
  s.spec.references = ASSETS.map((a) => ({ assetId: a.id, strength: "close" as const }));
  return s;
})();

const WITH_STYLE: BrandKitOverview = {
  ...DATA,
  defaultStyleId: STYLE_ID,
  styles: [
    {
      id: STYLE_ID,
      name: "Launch look",
      version: 1,
      spec: {
        ...applySuggestion(emptySpec(), SUGGESTION.spec),
        references: SUGGESTION.spec.references,
      },
      appliesTo: [],
      description: null,
      isDefault: true,
      status: "ready",
      coverUrl: null,
      createdAt: "",
      updatedAt: "",
      archived: false,
    },
  ],
};

export function BrandKitLab() {
  const [spec, setSpec] = React.useState<StyleSpec>(() => ({
    ...applySuggestion(emptySpec(), SUGGESTION.spec),
    references: SUGGESTION.spec.references,
  }));
  const [name, setName] = React.useState("");
  const [makeDefault, setMakeDefault] = React.useState(true);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1100px] space-y-12 px-4 py-10">
        <section>
          <h2 className="ds-label mb-4">Styles</h2>
          <StylesGallery
            workspaceId="lab"
            data={WITH_STYLE}
            onOpen={() => undefined}
            onCreate={() => undefined}
          />
        </section>
        <section data-testid="lab-editor">
          <h2 className="ds-label mb-4">Edit a style</h2>
          <StyleEditor
            workspaceId="lab"
            data={WITH_STYLE}
            styleId={STYLE_ID}
            onBack={() => undefined}
          />
        </section>
        <section>
          <h1 className="ds-label mb-4">Learned from examples</h1>
          <FinishStep
            data={DATA}
            suggestion={SUGGESTION}
            spec={spec}
            onSpec={setSpec}
            name={name}
            onName={setName}
            appliesTo={[]}
            makeDefault={makeDefault}
            onMakeDefault={setMakeDefault}
            busy={false}
            onCreate={() => undefined}
          />
          <pre
            data-testid="lab-spec"
            className="ds-well mt-4 max-h-40 overflow-auto p-3 text-[11px] leading-relaxed"
          >
            {JSON.stringify({ visual: spec.visual, references: spec.references }, null, 1)}
          </pre>
        </section>
        <section>
          <h2 className="ds-label mb-4">New style, from the start</h2>
          <CreateStyleFlow
            workspaceId="lab"
            data={DATA}
            onCancel={() => undefined}
            onCreated={() => undefined}
          />
        </section>
      </div>
    </div>
  );
}
