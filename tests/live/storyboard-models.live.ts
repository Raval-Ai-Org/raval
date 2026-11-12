// Side-by-side check of two models on real video storyboards, before a model
// swap on `studio.video.storyboard` (cost review 2026-11-12). Spends a few
// cents per model per brief; runs only when both are named:
//   STORYBOARD_COMPARE_MODELS=anthropic/claude-opus-5.5,google/gemini-4-carbon \
//   npx vitest run --config vitest.live.config.ts tests/live/storyboard-models.live.ts
// Each storyboard goes through the same pure checks Studio uses
// (`storyboardIssues`); the full output, cost and time are written to
// STORYBOARD_COMPARE_OUT (a folder) for a person to read side by side.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const models = (process.env.STORYBOARD_COMPARE_MODELS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const live = models.length >= 2 && !!process.env.OPENROUTER_API_KEY ? describe : describe.skip;

const BRIEFS = [
  {
    brand: "Northwind Coffee",
    kind: "product-showcase",
    seconds: 16,
    brief: "Show off our new oat-milk cold brew can: crisp, cold, made for summer.",
  },
  {
    brand: "Fernleaf Studio",
    kind: "brand-story",
    seconds: 24,
    brief: "How a two-person pottery studio hand-throws every mug, from clay to the kiln.",
  },
  {
    brand: "Brightpath Tutors",
    kind: "how-it-works",
    seconds: 16,
    brief: "Booking a tutor in three steps: pick a subject, choose a time, start learning.",
  },
] as const;

live("storyboard model comparison (live)", () => {
  const rows: UsageRecord[] = [];
  let restore: (() => void) | null = null;
  const summary: string[] = [];
  const out = process.env.STORYBOARD_COMPARE_OUT ?? join(process.cwd(), ".storyboard-compare");

  beforeAll(async () => {
    mkdirSync(out, { recursive: true });
    const { setUsageSink } = await import("@/server/ai/metering");
    restore = setUsageSink(async (row) => {
      rows.push(row);
    });
  });
  afterAll(() => {
    restore?.();
    writeFileSync(join(out, "summary.txt"), summary.join("\n") + "\n");
    console.info(summary.join("\n"));
  });

  for (const model of models) {
    for (const b of BRIEFS) {
      it(`${model} · ${b.kind}`, async () => {
        process.env.AI_MODEL_STUDIO_VIDEO_STORYBOARD = model;
        const [{ buildVideoStoryboardPrompt, emptyContext, ANGLES }, { runStructuredPrompt }] =
          await Promise.all([import("@/lib/studio/prompts"), import("@/lib/ai/run.server")]);
        const [{ clipPlan }, { fitStoryboard, storyboardIssues }] = await Promise.all([
          import("@/lib/studio/video/lengths"),
          import("@/lib/studio/video/storyboard"),
        ]);
        const plan = clipPlan(b.seconds, "standard");
        const built = buildVideoStoryboardPrompt({
          ctx: emptyContext(b.brand),
          intent: { brief: b.brief },
          controls: { platforms: ["instagram"], durationSec: b.seconds, videoKind: b.kind },
          angle: ANGLES[0],
          video: { kind: b.kind, plan, fromPicture: false },
        });
        const before = rows.length;
        const started = Date.now();
        const result = await runStructuredPrompt({ ...built, maxTokens: built.maxTokens ?? 6000 });
        const seconds = (Date.now() - started) / 1000;
        const storyboard = fitStoryboard(result.storyboard, plan);
        const issues = storyboardIssues(storyboard, { kind: b.kind, plan, knownFacts: "" });
        const spent = rows.slice(before);
        const cost = spent.reduce((sum, r) => sum + Number(r.est_cost_usd ?? 0), 0);
        const answered = [...new Set(spent.map((r) => r.model))].join("+");
        summary.push(
          `${model.padEnd(28)} ${b.kind.padEnd(17)} issues=${issues.length} calls=${spent.length} $${cost.toFixed(4)} ${seconds.toFixed(0)}s (${answered})`,
        );
        writeFileSync(
          join(out, `${model.replace(/\W+/g, "_")}__${b.kind}.json`),
          JSON.stringify({ model, answered, cost, seconds, issues, storyboard }, null, 2),
        );
        expect(storyboard.clips).toHaveLength(plan.length);
      }, 240_000);
    }
  }
});
