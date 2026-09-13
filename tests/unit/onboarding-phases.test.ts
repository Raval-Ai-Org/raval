import { describe, expect, it } from "vitest";
import {
  SCAN_PHASES,
  advancePhase,
  phaseIndexForStage,
  phaseStatus,
} from "@/components/onboarding/phases";
import { splitGuidance } from "@/components/onboarding/guidance";

// The order runBrandExtraction reports its stages in.
const PIPELINE = [
  "fetch_home",
  "discover",
  "sitemap",
  "crawl",
  "signals",
  "search",
  "analyze",
  "finalize",
  "done",
];

describe("onboarding scan phases", () => {
  it("maps every pipeline stage to a phase, in non-decreasing order", () => {
    const indexes = PIPELINE.map(phaseIndexForStage);
    expect(indexes.every((i) => i >= 0 && i < SCAN_PHASES.length)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    expect(indexes.at(-1)).toBe(SCAN_PHASES.length - 1);
  });

  it("never moves backwards, and ignores stages without a position", () => {
    expect(advancePhase(3, "crawl")).toBe(3);
    expect(advancePhase(2, "retry")).toBe(2);
    expect(advancePhase(1, "analyze")).toBe(3);
  });

  it("derives per-phase status", () => {
    expect(phaseStatus(0, 2, false)).toBe("done");
    expect(phaseStatus(2, 2, false)).toBe("active");
    expect(phaseStatus(4, 2, false)).toBe("pending");
    expect(phaseStatus(4, 2, true)).toBe("done");
  });
});

describe("splitGuidance", () => {
  it("splits lists, bullets and multi-sentence rules", () => {
    expect(splitGuidance("- Be direct\n- Use data")).toEqual(["Be direct", "Use data"]);
    expect(splitGuidance("Be direct; avoid jargon")).toEqual(["Be direct", "avoid jargon"]);
    expect(splitGuidance("Lead with outcomes. Show real numbers.")).toEqual([
      "Lead with outcomes.",
      "Show real numbers.",
    ]);
    expect(splitGuidance("")).toEqual([]);
  });
});
