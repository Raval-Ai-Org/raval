// Round 6 of the reference study (docs/studio/reference-study-2026-10.md):
// every recipe learned from the small-business post wall is reachable.
import { describe, expect, it } from "vitest";
import { getAdFormat, pickAdFormat } from "./ad-formats";
import { AD_OBJECTIVES } from "./ad-objectives";
import { archetypeById, archetypePromptLines, pickArchetype } from "./art-direction";
import { detectDeliverable } from "./creative-knowledge";
import { HOOK_STYLES } from "./memory";

const LAYOUTS = [
  "not-equal",
  "still-object",
  "symbol-object",
  "line-engraving",
  "outcome-chips",
  "iso-panel",
  "heritage-ornament",
  "blob-event",
  "named-hero-card",
  "edge-word",
];

const AD_LAYOUTS = [
  "photo-band",
  "founder-promise",
  "negation-trio",
  "not-equal",
  "live-moment",
  "checklist-split",
  "stat-card-photo",
];

describe("round 6 recipes", () => {
  it("every picture layout exists and builds a prompt", () => {
    for (const id of LAYOUTS) {
      const a = archetypeById(id);
      expect(a, id).not.toBeNull();
      expect(archetypePromptLines(a!, { hero: "the hero" }).join("\n")).toContain(a!.name);
    }
  });

  it("a mix-up is detected and staged as a not-equal poster", () => {
    const d = detectDeliverable({ text: "Revenue ≠ profit" });
    expect(d.id).toBe("mix-up");
    expect(detectDeliverable({ text: "Busy is not the same as productive" }).id).toBe("mix-up");
    const picks = new Set(
      Array.from(
        { length: 30 },
        (_, i) =>
          pickArchetype({ brandText: "accounting firm", seed: `m${i}`, prefer: d.prefer }).id,
      ),
    );
    expect(picks.has("not-equal")).toBe(true);
  });

  it("an event can get the organic event poster", () => {
    const d = detectDeliverable({ text: "Happy hour every Tuesday, join us" });
    expect(d.prefer).toContain("blob-event");
  });

  it("every ad layout exists, is offered by an objective and is pickable", () => {
    for (const id of AD_LAYOUTS) {
      expect(getAdFormat(id), id).not.toBeNull();
      expect(
        AD_OBJECTIVES.some((o) => o.formats.includes(id)),
        id,
      ).toBe(true);
      expect(pickAdFormat({ chosen: id, hasProduct: false, seed: "x" }).id).toBe(id);
    }
  });

  it("the new openings are in the rotation", () => {
    const ids = HOOK_STYLES.map((h) => h.id);
    for (const id of ["paradox", "negation", "right-now"]) expect(ids).toContain(id);
  });
});
