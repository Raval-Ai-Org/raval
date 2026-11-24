// Round 9 golden test (ADR-0053): with every skill pack off, the studio
// prompts for all benchmark cases are byte-identical to the prompts before
// Round 9. The hashes in evals/creative/golden-off.json were made by running
// this file on the last commit before the round (GOLDEN_WRITE=<path>).
// A deliberate prompt change elsewhere regenerates them with that note.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASES, brandOf, type BenchCase } from "../../../evals/creative/cases";
import {
  ANGLES,
  buildAdPrompt,
  buildCaptionPrompt,
  buildCarouselPrompt,
  buildVisualBriefPrompt,
  emptyContext,
} from "./prompts";
import { getAdObjective } from "./ad-objectives";
import { pickAdFormat } from "./ad-formats";
import { pickCarouselStructure } from "./carousel/story";

function base(c: BenchCase, i: number) {
  const brand = brandOf(c.brand);
  return {
    ctx: {
      ...emptyContext(brand.name),
      brandText: brand.dna,
      visualBrandText: brand.dna,
      industry: brand.industry,
      audience: brand.audience,
      website: brand.website,
      today: "2026-11-13",
    },
    intent: { brief: c.brief, goal: c.goal, category: c.category } as never,
    controls: { platforms: c.platforms, durationSec: 16 } as never,
    angle: ANGLES[i % ANGLES.length],
  };
}

function prompts(c: BenchCase, i: number): string[] {
  const b = base(c, i);
  const out: { system: string; user: string }[] = [];
  if (c.kind === "image" || c.kind === "meme" || c.kind === "educational") {
    out.push(buildVisualBriefPrompt({ ...b, medium: "image" } as never));
    out.push(buildCaptionPrompt({ ...b, visual: "(concept)" } as never));
  } else if (c.kind === "sales") {
    const objective = getAdObjective(c.adObjective);
    const adFormat = pickAdFormat({
      objective,
      hasProduct: false,
      seed: c.id,
      goal: c.goal as never,
    });
    out.push(buildAdPrompt({ ...b, adObjective: objective, adFormat } as never));
    out.push(buildVisualBriefPrompt({ ...b, medium: "image" } as never));
  } else if (c.kind === "carousel") {
    const carouselStructure = pickCarouselStructure({
      seed: c.id,
      brief: c.brief,
      category: c.category,
      angleId: b.angle.id,
    });
    out.push(buildCarouselPrompt({ ...b, carouselStructure } as never));
  }
  return out.map((p) => `${p.system}\n----\n${p.user}`);
}

function hashes(): Record<string, string> {
  const out: Record<string, string> = {};
  CASES.forEach((c, i) => {
    const text = prompts(c, i);
    if (text.length) out[c.id] = createHash("sha256").update(text.join("\n====\n")).digest("hex");
  });
  return out;
}

describe("creative golden (skills off)", () => {
  it("matches the prompts from before Round 9", () => {
    const now = hashes();
    if (process.env.GOLDEN_WRITE) {
      writeFileSync(process.env.GOLDEN_WRITE, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const golden = JSON.parse(
      readFileSync(join(__dirname, "../../../evals/creative/golden-off.json"), "utf8"),
    ) as Record<string, string>;
    expect(Object.keys(now).length).toBeGreaterThan(40);
    expect(now).toEqual(golden);
  });
});
