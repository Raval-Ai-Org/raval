import { describe, expect, it } from "vitest";
import { CreateJobSchema, type ScriptOutput } from "./jobs";
import { creatorBrief, scriptScenes, sourceScriptDirection, toCreatorScript } from "./script-video";
import { buildModelPrompt } from "@/lib/ugc/prompt-adapters";
import { UGC_MODELS } from "@/lib/ugc/models";
import { CreateProjectBody, ProductSchema } from "@/lib/ugc/schemas";

export const reviewedScript: ScriptOutput = {
  title: "The full reviewed script",
  hook: "This is the opening.",
  beats: Array.from({ length: 12 }, (_, i) => ({
    time: `${i * 5}–${(i + 1) * 5}s`,
    visual: `Scene ${i + 1}: ${"The original product stays in view. ".repeat(5)}`,
    voiceover: `Line ${i + 1}: ${"Keep these exact spoken words. ".repeat(7)}`.trim(),
    onScreen: `Caption ${i + 1}`,
  })),
  cta: "See the product today.",
  caption: "The caption stays separate from speech.",
  durationSec: 60,
};
const workspaceId = "00000000-0000-4000-8000-000000000001";

describe("reviewed script to video", () => {
  it("carries the full script through the video API contract beyond the brief limit", () => {
    expect(JSON.stringify(reviewedScript).length).toBeGreaterThan(4000);
    const input = CreateJobSchema.parse({
      workspaceId,
      type: "video",
      idempotencyKey: "script-video-handoff",
      intent: { brief: "Make my reviewed script into a video", sourceScript: reviewedScript },
      controls: { platforms: ["instagram"], durationSec: 60 },
    });
    expect(input.intent.sourceScript).toEqual(reviewedScript);
    const direction = sourceScriptDirection(input.intent.sourceScript!);
    for (const beat of reviewedScript.beats) {
      expect(direction).toContain(beat.visual);
      expect(direction).toContain(beat.voiceover);
    }
    expect(direction).not.toContain(reviewedScript.caption);
  });

  it("imports every scene atomically into a creator project without rewriting speech", () => {
    const source = { workspaceId, script: reviewedScript, platforms: ["instagram" as const] };
    const input = CreateProjectBody.parse({
      workspaceId,
      product: { name: "The actual product" },
      brief: creatorBrief(source),
      script: toCreatorScript(reviewedScript),
    });
    expect(input.brief.platform).toBe("reels");
    expect(input.brief.scriptSource).toBe("studio");
    expect(input.brief.durationSec).toBe(60);
    expect(input.script?.scenes.map((s) => s.dialogue)).toEqual(
      reviewedScript.beats.map((b) => b.voiceover),
    );
    expect(input.script?.scenes.at(-1)?.end).toBe(60);
    expect(input.script?.postCaption).toBe(reviewedScript.caption);
  });

  it("never silently cuts later scenes from the final creator provider prompt", () => {
    const prompt = buildModelPrompt({
      product: ProductSchema.parse({ name: "The product" }),
      brief: creatorBrief({ workspaceId, script: reviewedScript, platforms: ["tiktok"] }),
      script: toCreatorScript(reviewedScript),
      model: UGC_MODELS.standard,
      durationSec: 60,
      aspectRatio: "9:16",
      imageCount: 0,
    });
    for (const beat of reviewedScript.beats) expect(prompt).toContain(beat.voiceover);
    expect(prompt).toContain("original language (do not translate)");
    expect(prompt).toContain("MODEL DIRECTION:");
  });

  it("keeps visual-only scripts silent and falls back to complete timings", () => {
    const script = {
      ...reviewedScript,
      beats: reviewedScript.beats.map((b) => ({ ...b, time: "Opening", voiceover: "" })),
    };
    const scenes = scriptScenes(script);
    expect(scenes[0].start).toBe(0);
    expect(scenes.at(-1)?.end).toBe(60);
    expect(scenes.every((s) => !s.dialogue)).toBe(true);
    expect(sourceScriptDirection(reviewedScript, false)).not.toContain("The creator says:");
  });
});
