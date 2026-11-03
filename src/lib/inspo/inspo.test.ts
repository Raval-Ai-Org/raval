import { describe, expect, it } from "vitest";
import type { VisualSource } from "@/lib/brand-visuals/contracts";
import { canLearn, chipOf, inspoCards, purposeOf, shelfCards, studioReferenceMode } from "./board";
import { addExample, tidyLook } from "./look";
import { parseInspoSection } from "./sections";
import { styleSteps, styleStrength } from "./strength";
import { voiceSample } from "./voice-sample";

let n = 0;
function source(p: Partial<VisualSource> & { mime?: string }): VisualSource {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspace_id: "w",
    asset_id: `a${n}`,
    kind: "upload",
    purpose: "style",
    status: "approved",
    label: `Ref ${n}`,
    notes: "",
    formats: [],
    campaign: null,
    source_url: null,
    capture_job_id: null,
    region: {},
    created_at: new Date(2026, 9, n).toISOString(),
    asset: { storage_path: "p", mime_type: p.mime ?? "image/png", url: `https://x/${n}` },
    ...p,
  };
}

describe("inspo sections", () => {
  it("maps old Brand tiles onto their new place", () => {
    expect(parseInspoSection("look")).toBe("post");
    expect(parseInspoSection("assets")).toBe("media");
    expect(parseInspoSection("voice")).toBe("voice");
    expect(parseInspoSection("nope")).toBe("board");
    expect(parseInspoSection(null)).toBe("board");
  });
});

describe("inspo board", () => {
  it("maps purposes to chips and back", () => {
    expect(chipOf("style")).toBe("like");
    expect(chipOf("inspiration")).toBe("like");
    expect(purposeOf("like", "inspiration")).toBe("inspiration");
    expect(purposeOf("like", "avoid")).toBe("style");
    expect(purposeOf("product")).toBe("product");
  });

  it("hides removed rows, page captures and a video's frames", () => {
    const video = source({ label: "Reel", mime: "video/mp4" });
    const frame = source({ label: "Reel · 1.5s" });
    const cards = inspoCards([
      video,
      frame,
      source({ status: "removed" }),
      source({ kind: "website", region: { type: "full" } }),
      source({ kind: "website", region: { type: "section" } }),
      source({ purpose: "product" }),
    ]);
    expect(cards.map((c) => c.kind)).not.toContain(undefined);
    expect(cards.find((c) => c.id === frame.id)).toBeUndefined();
    expect(cards.find((c) => c.id === video.id)?.frameIds).toEqual([frame.id]);
    expect(cards.filter((c) => c.fromSite)).toHaveLength(1);
    expect(shelfCards(cards, "media")).toHaveLength(1);
    expect(cards[0].createdAt >= cards[cards.length - 1].createdAt).toBe(true);
  });

  it("learns only from a liked picture", () => {
    expect(canLearn(inspoCards([source({ purpose: "avoid" })]))).toBe(false);
    expect(canLearn(inspoCards([source({ mime: "video/mp4" })]))).toBe(false);
    expect(canLearn(inspoCards([source({})]))).toBe(true);
  });

  it("never sends an avoid card to Studio", () => {
    expect(studioReferenceMode("avoid")).toBeNull();
    expect(studioReferenceMode("product")).toBe("design");
    expect(studioReferenceMode("like")).toBe("inspire");
  });
});

describe("style strength", () => {
  it("is empty with nothing saved and full with everything", () => {
    const empty = styleStrength(
      styleSteps({ look: {}, cards: [], hasLogo: false, hasDirection: false }),
    );
    expect(empty).toEqual({ score: 0, level: "Empty" });
    const cards = inspoCards([source({}), source({}), source({}), source({ purpose: "person" })]);
    const full = styleStrength(
      styleSteps({
        look: {
          visual: { medium: "photo", palette: { primary: "#000000" } },
          video: { pacing: "fast" },
          writing: { emoji: "none", examples: ["A post"] },
        },
        cards,
        hasLogo: true,
        hasDirection: true,
      }),
    );
    expect(full.score).toBe(100);
    expect(full.level).toBe("Strong");
  });
});

describe("look writes", () => {
  it("drops empty sections", () => {
    expect(tidyLook({ writing: { bannedWords: [] }, visual: { medium: "photo" } })).toEqual({
      v: 1,
      writing: undefined,
      visual: { medium: "photo" },
      video: undefined,
    });
  });
  it("keeps three example posts, newest first, no repeats", () => {
    let list = addExample(undefined, " one ");
    list = addExample(list, "two");
    list = addExample(list, "one");
    list = addExample(list, "three");
    list = addExample(list, "four");
    expect(list).toEqual(["four", "three", "two"]);
    expect(addExample(list, "   ")).toBe(list);
  });
});

describe("voice sample", () => {
  it("follows the sliders", () => {
    const formal = voiceSample({ tone: { casual: 10, playful: 10, detailed: 50, bold: 20 } });
    const fun = voiceSample({
      tone: { casual: 90, playful: 90, detailed: 50, bold: 90 },
      emoji: "heavy",
    });
    expect(formal).toMatch(/pleased to introduce/);
    expect(formal.endsWith(".")).toBe(true);
    expect(fun).toMatch(/^Hey friends!/);
    expect(fun).toMatch(/🔥/);
    expect(voiceSample({ person: "i" })).toMatch(/^I /);
    expect(voiceSample({ hashtags: { always: ["acme"] } })).toMatch(/#acme$/);
  });
});
