// Live check of Creator video formats (ADR-0046): the real script writer
// (route `ugc.concepts`, Sonnet 5.5 through OpenRouter) writes ideas for three
// formats, and the code checks and the video prompt are run on what came back.
//
// Writing is three model calls (a few cents), so it runs only behind
// UGC_FORMATS_LIVE_RENDER=yes. It renders no video and stores nothing: the
// prompts it built are written to UGC_FORMATS_LIVE_OUT (default: the OS temp
// folder) for a person to read. A real render needs a signed-in workspace
// and Video Credits; make one from the Creator screen.
//   UGC_FORMATS_LIVE_RENDER=yes npx vitest run --config vitest.live.config.ts tests/live/ugc-formats.live.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive =
  process.env.OPENROUTER_API_KEY && process.env.UGC_FORMATS_LIVE_RENDER === "yes"
    ? describe
    : describe.skip;

const FORMATS = ["subway-interview", "car-confessional", "pov-skit"] as const;

describeLive("Creator video formats (live)", () => {
  const out = process.env.UGC_FORMATS_LIVE_OUT || join(tmpdir(), "ugc-formats-live");
  mkdirSync(out, { recursive: true });

  for (const id of FORMATS) {
    it(`writes ${id} ideas that pass the checks and build a phone-footage prompt`, async () => {
      const { generateConcepts } = await import("@/server/ugc/concepts.server");
      const { BriefSchema, ProductSchema } = await import("@/lib/ugc/schemas");
      const { buildModelPrompt } = await import("@/lib/ugc/prompt-adapters");
      const { formatScriptIssues, ugcFormat } = await import("@/lib/ugc/formats");
      const { UGC_MODELS } = await import("@/lib/ugc/models");

      const product = ProductSchema.parse({
        name: "Northwind Cold Brew",
        brand: "Northwind",
        description: "Ready-to-drink cold brew coffee in a 330 ml can, no sugar added.",
        category: "Coffee",
        facts: [
          { id: "f1", text: "No sugar added", source: "user" },
          { id: "f2", text: "330 ml can", source: "user" },
        ],
      });
      const brief = BriefSchema.parse({ format: id, objective: "awareness", durationSec: 12 });
      const concepts = await generateConcepts({
        product,
        brief,
        brand: { brandName: "Northwind", voice: "Dry, warm, a little funny" },
        workspace: { industry: "Coffee", audience: "Commuters 22-35" },
        durationSec: 12,
        seed: `live:${id}`,
      });
      expect(concepts.length).toBeGreaterThan(0);

      const format = ugcFormat(id)!;
      const best = concepts[0];
      expect(best.script.format).toBe(id);
      const issues = formatScriptIssues(best.script, format, { productName: product.name });
      const prompt = buildModelPrompt({
        product,
        brief,
        script: best.script,
        model: UGC_MODELS.long,
        durationSec: 12,
        aspectRatio: "9:16",
        imageCount: 1,
        creatorImage: true,
        seed: `live:${id}`,
      });
      writeFileSync(
        join(out, `${id}.txt`),
        [
          `HOOK TEXT: ${best.script.onScreen}`,
          `ISSUES: ${issues.join(" | ") || "none"}`,
          "",
          prompt,
        ].join("\n"),
      );
      console.log(`[ugc-formats] ${id}: ${issues.length} issues, prompt in ${out}`);

      expect(prompt).toMatch(/^Real vertical/);
      expect(prompt).not.toMatch(/UGC video ad/i);
      expect(best.script.onScreen.trim().length).toBeGreaterThan(0);
      // The best idea is the cleanest one; it should need no more than one fix.
      expect(issues.length).toBeLessThanOrEqual(1);
    }, 180_000);
  }
});
