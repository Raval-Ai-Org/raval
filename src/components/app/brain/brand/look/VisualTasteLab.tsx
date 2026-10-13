"use client";
import { useState } from "react";
import { emptyDna } from "@/hooks/use-brand-dna";
import { DirectionSchema, type VisualView } from "@/lib/brand-visuals/contracts";
import { VisualTastePanel } from "./VisualTastePanel";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
const workspaceId = "00000000-0000-4000-8000-000000000099";
const sourceId = "00000000-0000-4000-8000-000000000001";
const art = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#f5f1e8"/><circle cx="320" cy="300" r="170" fill="#495a45"/><path d="M0 650L640 490V800H0" fill="#cba66c"/><text x="50" y="710" font-family="serif" font-size="45" fill="#223325">Thoughtfully made</text></svg>')}`;
const direction = DirectionSchema.parse({
  name: "Quiet editorial",
  summary: "Warm natural textures, spacious layouts and understated serif headings.",
  visual: {
    medium: "photo",
    mood: "warm and calm",
    palette: { primary: "#495a45", background: "#f5f1e8", text: "#223325", accent: "#cba66c" },
    typography: { heading: "DM Serif Display", body: "Inter" },
  },
  sourceIds: [sourceId],
});
const fixture: VisualView = {
  available: true,
  canEdit: true,
  activeId: null,
  jobs: [],
  feedback: [],
  profiles: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      workspace_id: workspaceId,
      status: "candidate",
      created_at: "2026-10-13T00:00:00Z",
      capture_job_id: null,
      profile: {
        v: 1,
        selected: 0,
        coverage: ["https://example.com/"],
        warnings: [],
        observations: [],
        directions: [
          direction,
          {
            ...direction,
            name: "Product first",
            layout: "frame",
            summary: "The same warm identity, with product photography leading each post.",
          },
          {
            ...direction,
            name: "Bold detail",
            layout: "bold",
            summary: "Close crops and stronger headings within the same approved palette.",
          },
        ],
      },
    },
  ],
  sources: [
    {
      id: sourceId,
      workspace_id: workspaceId,
      asset_id: "00000000-0000-4000-8000-000000000002",
      kind: "upload",
      purpose: "style",
      status: "approved",
      label: "Approved reference",
      notes: "The warm palette and generous spacing",
      formats: [],
      campaign: null,
      source_url: null,
      capture_job_id: null,
      region: {},
      created_at: "2026-10-13T00:00:00Z",
      asset: { storage_path: "fixture", mime_type: "image/png", url: art },
    },
  ],
};
fixture.sources.push({
  ...fixture.sources[0],
  id: "00000000-0000-4000-8000-000000000004",
  asset_id: "00000000-0000-4000-8000-000000000005",
  kind: "website",
  status: "candidate",
  label: "Website hero detail",
  notes: "",
  source_url: "https://example.com/",
  region: { type: "section", top: 0, page: 0 },
});
export function VisualTasteLab() {
  const [dark, setDark] = useState(false);
  return (
    <div
      data-mellox-app
      className={cn("min-h-screen bg-background text-foreground", dark && "dark")}
    >
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="ds-page-title">Look & voice</h1>
          <button className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")} onClick={() => setDark(!dark)}>
            {dark ? "Light theme" : "Dark theme"}
          </button>
        </div>
        <VisualTastePanel
          workspaceId={workspaceId}
          dna={{
            ...emptyDna,
            brandName: "Northside",
            websiteUrl: "https://example.com/",
            colors: [{ name: "Primary", hex: "#495a45" }],
            fonts: ["DM Serif Display", "Inter"],
          }}
          fixture={fixture}
        />
      </div>
    </div>
  );
}
