// Side-by-side check of two models on a real motion graphic (route
// `studio.motion.compose`), before a model swap. Spends a few cents per model;
// usage is kept in-process (nothing is metered against a workspace):
//   MOTION_COMPARE_MODELS=anthropic/claude-opus-5.5,google/gemini-4-carbon \
//   MOTION_COMPARE_OUT=<folder> npx vitest run --config vitest.live.config.ts tests/live/motion-models.live.ts
// Needs Chromium and FFmpeg, like the motion pipeline itself.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const models = (process.env.MOTION_COMPARE_MODELS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const live = models.length >= 2 && !!process.env.OPENROUTER_API_KEY ? describe : describe.skip;

const FACTS = JSON.stringify({
  brandName: "Northwind Coffee",
  description: "Small-batch coffee roaster in Portland selling cold brew cans and beans online.",
  products: ["Oat-milk cold brew can", "Single-origin beans"],
  tone: "Warm, plain, confident",
  website: "northwind.example",
  colors: { primary: "#1F3A2E", accent: "#E8B04B", background: "#F6F1E7" },
});

live("motion graphic model comparison (live)", () => {
  const rows: UsageRecord[] = [];
  let restore: (() => void) | null = null;
  const summary: string[] = [];
  const out = process.env.MOTION_COMPARE_OUT ?? join(process.cwd(), ".motion-compare");

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
    it(`${model} designs an 8 s motion graphic`, async () => {
      process.env.AI_MODEL_STUDIO_MOTION_COMPOSE = model;
      const { makeMotionGraphic } = await import("@/server/studio/motion/compose.server");
      const before = rows.length;
      const started = Date.now();
      const result = await makeMotionGraphic({
        workspaceId: "00000000-0000-4000-8000-00000000c0de",
        brief:
          "A short brand moment for Northwind Coffee: the new oat-milk cold brew, and a call to visit.",
        seconds: 8,
        ratio: "9:16",
        brandText: "Brand: Northwind Coffee",
        brandName: "Northwind Coffee",
        knownFacts: FACTS,
        seed: 1,
      });
      const spent = rows.slice(before).filter((r) => r.route === "studio.motion.compose");
      const cost = spent.reduce((sum, r) => sum + Number(r.est_cost_usd ?? 0), 0);
      const tag = model.replace(/\W+/g, "_");
      summary.push(
        `${model.padEnd(28)} ok=${result.ok} attempts=${result.attempts} calls=${spent.length} $${cost.toFixed(4)} ${((Date.now() - started) / 1000).toFixed(0)}s` +
          (result.ok ? "" : ` reason=${result.reason} issues=${JSON.stringify(result.issues)}`) +
          ` calls=${JSON.stringify(spent.map((r) => ({ model: r.model, status: r.status, out: r.output_tokens, reasoning: r.reasoning_tokens, error: r.error_code ?? r.error })))}`,
      );
      if (result.ok) {
        writeFileSync(join(out, `${tag}.mp4`), result.video);
        result.samples.slice(0, 4).forEach((frame: unknown, i: number) => {
          if (Buffer.isBuffer(frame)) writeFileSync(join(out, `${tag}_frame${i}.png`), frame);
        });
      }
      expect(spent.length).toBeGreaterThan(0);
    }, 600_000);
  }
});
