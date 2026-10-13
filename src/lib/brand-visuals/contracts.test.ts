import { describe, expect, it } from "vitest";
import {
  DirectionSchema,
  ProfileSchema,
  selectReferences,
  representativePages,
  directionRules,
  analysisReferences,
  visualFeedbackRules,
  type VisualSource,
} from "./contracts";
import { applyVisualTaste } from "./apply";
import { resolveLook } from "@/lib/brand-look/resolve";
import { studioChargeFor } from "@/lib/studio/billing";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = (n: number, patch: Partial<VisualSource> = {}): VisualSource => ({
  id: id(n),
  workspace_id: id(99),
  asset_id: id(n + 100),
  kind: "upload",
  purpose: "style",
  status: "approved",
  label: "Example",
  notes: "",
  formats: [],
  campaign: null,
  source_url: null,
  capture_job_id: null,
  region: {},
  created_at: "2026-10-13T00:00:00Z",
  asset: {
    storage_path: `workspace/${id(99)}/assets/${id(n + 100)}/original.png`,
    mime_type: "image/png",
  },
  ...patch,
});
const direction = DirectionSchema.parse({
  name: "Editorial",
  summary: "Warm photographs and clear type",
  visual: { palette: { primary: "#334455", background: "#faf7ef" }, medium: "photo" },
  sourceIds: [id(1)],
});
describe("visual taste decisions", () => {
  it("uses repeated explicit corrections and keeps a single rejection from changing brand guidance", () => {
    expect(visualFeedbackRules([{ reason: "too-busy" }])).toBe("");
    const rules = visualFeedbackRules(Array.from({ length: 3 }, () => ({ reason: "too-busy" })));
    expect(rules).toContain("Reduce incidental background clutter");
    expect(rules).toContain("approved layout");
  });
  it("uses every correction category without replacing the approved visual medium", () => {
    const rows = ["wrong-theme", "wrong-product", "typography", "too-artificial"].flatMap(
      (reason) => Array.from({ length: 3 }, () => ({ reason })),
    );
    const rules = visualFeedbackRules(rows);
    expect(rules).toContain("verified details");
    expect(rules).toContain("composition stage");
    expect(rules).toContain("approved medium and texture");
  });
  it("applies post references to social-image generation and video references to video Stories", () => {
    const post = source(1, { formats: ["image"] });
    const video = source(2, { formats: ["video"] });
    const story = source(3, { formats: ["story"] });
    expect(selectReferences([post, video, story], { format: "social" })).toEqual([post]);
    expect(selectReferences([post, video, story], { format: "story-video" })).toEqual([
      video,
      story,
    ]);
  });
  it("balances visual analysis across pages and preserves homepage evidence", () => {
    const sources = Array.from({ length: 4 }, (_, page) =>
      Array.from({ length: 4 }, (_, crop) =>
        source(page * 4 + crop, {
          kind: "website",
          capture_job_id: id(50),
          source_url: `https://brand.test/${page || ""}`,
          region: { type: "section", page, top: crop * 1000 },
        }),
      ),
    )
      .flat()
      .reverse();
    const selected = analysisReferences(sources);
    expect(selected).toHaveLength(8);
    expect(new Set(selected.map((s) => s.region.page)).size).toBe(4);
    expect(selected[0].region).toMatchObject({ page: 0, top: 0 });
  });
  it("uses approved applicable image evidence, excludes avoid/removed/video and scopes campaigns", () => {
    const refs = [
      source(1),
      source(2, { status: "removed" }),
      source(3, { purpose: "avoid" }),
      source(4, { formats: ["video"] }),
      source(5, { campaign: "launch" }),
      source(6, { asset: { storage_path: "owned", mime_type: "video/mp4" } }),
    ];
    expect(selectReferences(refs, { format: "image" }).map((s) => s.id)).toEqual([id(1)]);
    expect(
      selectReferences(refs, { format: "image", campaign: "launch" }).map((s) => s.id),
    ).toEqual([id(1), id(5)]);
  });
  it("website captures must be explicitly selected; product identity wins limited reference slots", () => {
    const refs = [
      source(1, { kind: "website" }),
      source(2, { kind: "website" }),
      source(3, { purpose: "product" }),
    ];
    expect(selectReferences(refs, { format: "image", selectedIds: [id(1)], limit: 1 })[0].id).toBe(
      id(3),
    );
    expect(
      selectReferences(refs, { format: "image", selectedIds: [id(1)] }).map((s) => s.id),
    ).toEqual([id(3), id(1)]);
  });
  it("selects representative observed same-origin pages and excludes checkout and third parties", () => {
    expect(
      representativePages(
        "https://brand.test/",
        ["/privacy", "https://other.test/about", "/about", "/products/a", "/checkout", "/blog/one"],
        4,
      ),
    ).toEqual([
      "https://brand.test/",
      "https://brand.test/products/a",
      "https://brand.test/about",
      "https://brand.test/blog/one",
    ]);
  });
  it("manual look rules win while the approved direction supplies missing visual detail", () => {
    const manual = { visual: { palette: { primary: "#ff3300" }, medium: "illustration" as const } };
    const snapshot = {
      profileId: id(1),
      direction,
      rules: directionRules(direction),
      references: [],
      warnings: [],
    };
    const result = applyVisualTaste(
      resolveLook({ voice: "Friendly", look: manual }),
      manual,
      snapshot,
    );
    expect(result.visual.palette.primary).toBe("#ff3300");
    expect(result.visual.palette.background).toBe("#faf7ef");
    expect(result.visual.medium).toBe("illustration");
    expect(result.writing.voice).toBe("Friendly");
  });
  it("keeps plain brands unchanged and does not invent motion from still imagery", () => {
    const base = resolveLook(null);
    expect(applyVisualTaste(base, null, null)).toBe(base);
    expect(direction.video).toBeUndefined();
    expect(direction.composed).toBe(false);
    expect(direction.lockTheme).toBe(false);
    expect(directionRules({ ...direction, lockTheme: true })).toContain("do not rotate");
    expect(ProfileSchema.safeParse({ directions: [] }).success).toBe(false);
  });
  it("a still video preview consumes image credits; making the video uses its own meter", () => {
    expect(studioChargeFor({ type: "video", videoPreview: true })).toBe("image_post");
    expect(studioChargeFor({ type: "video", videoPreview: false })).toBe("studio_video");
    expect(studioChargeFor({ type: "video" })).toBe("studio_video");
    expect(studioChargeFor({ type: "story", storyMode: "video" })).toBe("studio_video");
    expect(studioChargeFor({ type: "story", storyMode: "video", videoPreview: true })).toBe(
      "image_post",
    );
  });
});
