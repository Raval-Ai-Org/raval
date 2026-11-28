// Live check of the 2026-11-28 provider split: posts on OpenRouter (Recraft
// V4.1 for plain pictures, Haiku for words), GPT-6.1 Sol kept on KIE.
// Opt-in, about $0.05:
//   npx vitest run --config vitest.live.config.ts tests/live/openrouter-switch.live.ts
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive =
  process.env.OPENROUTER_API_KEY?.trim() && process.env.OPENROUTER_SWITCH_LIVE === "yes"
    ? describe
    : describe.skip;

describeLive("OpenRouter first, KIE for kept models (live)", () => {
  const rows: (UsageRecord & { ms?: number })[] = [];
  let restoreSink: (() => void) | null = null;

  beforeAll(async () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.IMAGE_PROVIDER = "openrouter";
    const { setUsageSink } = await import("@/server/ai/metering");
    restoreSink = setUsageSink(async (row) => {
      rows.push(row);
    });
  });
  afterAll(() => {
    restoreSink?.();
    console.table(
      rows.map((r) => {
        const x = r as unknown as Record<string, unknown>;
        return {
          route: x.route,
          provider: x.provider,
          model: x.model,
          status: x.status,
          seconds: typeof (x.latencyMs ?? x.latency_ms) === "number" ? Math.round(Number(x.latencyMs ?? x.latency_ms) / 100) / 10 : null,
          usd: x.estCostUsd ?? x.est_cost_usd,
        };
      }),
    );
  });

  it("writes captions with Haiku on OpenRouter", async () => {
    const { chatCompletion } = await import("@/lib/ai-gateway.server");
    const started = Date.now();
    const json = await chatCompletion({
      route: "studio.captions",
      task: "generate",
      noCache: true,
      max_tokens: 200,
      messages: [
        { role: "system", content: "Write one short Instagram caption. Plain text." },
        { role: "user", content: "A local bakery's fresh sourdough, out of the oven at 7am." },
      ],
    });
    console.log("captions", Date.now() - started, "ms:", json.choices[0].message.content);
    expect(String(json.choices[0].message.content).length).toBeGreaterThan(10);
    expect(rows.at(-1)).toMatchObject({ provider: "openrouter", status: "ok" });
  });

  it("keeps GPT-6.1 Sol on KIE", async () => {
    const { chatCompletion } = await import("@/lib/ai-gateway.server");
    const json = await chatCompletion({
      route: "campaign-generation",
      task: "generate",
      noCache: true,
      max_tokens: 60,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    expect(String(json.choices[0].message.content).toLowerCase()).toContain("ready");
    expect(rows.at(-1)?.provider).toBe("kie");
  }, 120_000);

  it("draws a plain picture with Recraft V4.1 on OpenRouter", async () => {
    const { generateImage } = await import("@/lib/openrouter-image.server");
    const started = Date.now();
    const image = await generateImage({
      prompt:
        "A warm, bright Instagram post for a neighbourhood bakery: a fresh sourdough loaf on a wooden board, morning light, the words \"Fresh at 7am\" in a clean bold headline at the top.",
      size: "1024x1280",
      meterRoute: "studio.image.render",
    });
    const ms = Date.now() - started;
    console.log("picture", ms, "ms", image.model, "$", image.costUsd);
    writeFileSync(
      `${process.env.LIVE_OUT_DIR ?? "."}/recraft-live.${image.mimeType.includes("jpeg") ? "jpg" : "png"}`,
      Buffer.from(image.b64, "base64"),
    );
    expect(image.model).toMatch(/^recraft\//);
    expect(image.b64.length).toBeGreaterThan(10_000);
  }, 180_000);
});
