import { describe, expect, it } from "vitest";
import { STUDIO_TYPE_ORDER } from "@/lib/studio/formats";
import type { IdeaSignal } from "@/lib/studio/ideas";
import {
  PROMPT_BLUEPRINTS,
  PROMPT_MAX_CHARS,
  cleanPrompt,
  describeSettings,
  pickSignal,
  pickSparks,
} from "@/lib/studio/prompt-writer";

function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

const signals: IdeaSignal[] = [
  { source: "pillar", headline: "Handmade in small batches", detail: "", weight: 60 },
  { source: "trend", headline: "Cold brew searches rising", detail: "", weight: 80 },
  { source: "season", headline: "Summer starts in 5 days", detail: "", weight: 85 },
  { source: "competitor", headline: "Rival launched oat milk", detail: "", weight: 70 },
];

describe("prompt writer blueprints", () => {
  it("cover every format with a detailed section plan", () => {
    for (const type of STUDIO_TYPE_ORDER) {
      const b = PROMPT_BLUEPRINTS[type];
      expect(b.sections.length).toBeGreaterThanOrEqual(6);
      expect(b.guidance.length).toBeGreaterThan(120);
    }
  });

  it("ask visual formats for a look and motion formats for camera moves", () => {
    const image = pickSparks("image", seq([0.1, 0.5]));
    expect(image.some((s) => s.startsWith("Visual direction"))).toBe(true);
    const video = pickSparks("video", seq([0.2, 0.4, 0.9]));
    expect(video.some((s) => s.startsWith("Camera:"))).toBe(true);
    expect(pickSparks("article", seq([0.3]))).toHaveLength(1);
  });

  it("vary the creative direction with the random source", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 16; i++) seen.add(pickSparks("social", seq([i / 16, 0.5]))[0]);
    expect(seen.size).toBeGreaterThan(8);
  });
});

describe("pickSignal", () => {
  it("skips signals the person was recently given", () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const s = pickSignal(
        signals,
        ["Summer starts in 5 days", "cold brew SEARCHES rising"],
        seq([r]),
      );
      expect(s?.headline).not.toBe("Summer starts in 5 days");
      expect(s?.headline).not.toBe("Cold brew searches rising");
    }
  });

  it("falls back to all signals when every one was used", () => {
    const s = pickSignal(
      signals,
      signals.map((x) => x.headline),
      seq([0]),
    );
    expect(s).not.toBeNull();
  });

  it("favours timely and trending signals", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const s = pickSignal(signals, [], seq([i / 200]))!;
      counts[s.source] = (counts[s.source] ?? 0) + 1;
    }
    expect(counts.season + counts.trend).toBeGreaterThan(counts.pillar * 2);
    expect(pickSignal([], [])).toBeNull();
  });
});

describe("cleanPrompt", () => {
  it("turns markdown into plain labelled sections", () => {
    const out = cleanPrompt(
      "## Idea\n**Idea:** A tasting menu\n\n\n\n* point one\n• point two  \n",
    );
    expect(out).toBe("Idea\nIdea: A tasting menu\n\n- point one\n- point two");
  });

  it("keeps prompts within the description limit, ending on a full line", () => {
    const long = Array.from({ length: 400 }, (_, i) => `Line ${i}: ${"detail ".repeat(3)}`).join(
      "\n",
    );
    const out = cleanPrompt(long);
    expect(out.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
    expect(out.endsWith("detail")).toBe(true);
  });
});

describe("describeSettings", () => {
  it("states the chosen settings in plain words", () => {
    expect(
      describeSettings("video", { platforms: ["tiktok"], ratio: "9:16", durationSec: 8 }),
    ).toBe("Platforms: tiktok\nSize: 9:16\nLength: 8 seconds");
    expect(describeSettings("carousel", {})).toBe("Slides: 6");
  });
});
