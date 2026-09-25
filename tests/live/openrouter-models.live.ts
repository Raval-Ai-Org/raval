// Live check of the OpenRouter-only model setup (docs/adr/0026). Opt-in, small
// and cheap (~$0.05 without video):
//   npx vitest run --config vitest.live.config.ts tests/live/openrouter-models.live.ts
// One call per tier, one JSON-schema call, a two-turn tool loop on the premium
// tier (reasoning replay), one Flare image. The OpenRouter `draft` video
// (~$0.20–0.40) runs only with VIDEO_LIVE_OPENROUTER=yes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive = process.env.OPENROUTER_API_KEY?.startsWith("sk-or-")
  ? describe
  : describe.skip;
const videoIt = process.env.VIDEO_LIVE_OPENROUTER === "yes" ? it : it.skip;

describeLive("OpenRouter models (live)", () => {
  const rows: UsageRecord[] = [];
  let restoreSink: (() => void) | null = null;

  beforeAll(async () => {
    const { setUsageSink } = await import("@/server/ai/metering");
    // Kept in-process: nothing here is attributed to a workspace.
    restoreSink = setUsageSink(async (row) => {
      rows.push(row);
    });
  });
  afterAll(() => restoreSink?.());

  it.each([
    ["economy", "competitors.updates", "google/gemini-3.1-flash-lite"],
    ["workhorse", "ugc.notes", "google/gemini-3.8-flash"],
    ["premium", "brand-kit/analyze-writing", "anthropic/claude-opus-5.5"],
  ])(
    "answers on the %s tier",
    async (_tier, route, expected) => {
      const { llmText } = await import("@/lib/ai-gateway.server");
      const result = await llmText({
        route,
        system: "Answer in at most five words.",
        user: "Name one primary colour.",
      });
      console.info(`[live] ${route} → ${result.model} $${result.costUsd}`, result.text);
      expect(result.text.length).toBeGreaterThan(0);
      // Silent reroutes happen; the answering model is logged and metered either way.
      if (result.model !== expected) console.warn(`[live] ${route} answered by ${result.model}`);
      const row = rows.find((r) => r.route === route);
      expect(row).toMatchObject({ provider: "openrouter", model: result.model });
      expect(Number(row?.est_cost_usd)).toBeGreaterThan(0);
    },
    90_000,
  );

  it("returns schema-valid JSON", async () => {
    const { llmJson } = await import("@/lib/ai-gateway.server");
    const out = await llmJson<{ name: string; city: string } | null>({
      route: "experiments.values",
      system: "Extract the company and its city.",
      user: "Acme Shoes has made red trainers in Porto since 1998.",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "city"],
        properties: { name: { type: "string" }, city: { type: "string" } },
      },
      fallback: null,
    });
    expect(out).toMatchObject({ name: expect.stringContaining("Acme"), city: "Porto" });
  }, 90_000);

  it("runs a two-turn tool loop on the premium tier, replaying reasoning", async () => {
    const { llmToolLoop } = await import("@/lib/ai-gateway.tool-loop.server");
    const files: Record<string, string> = {
      "README.md": "# Mellox Live Test\nThe product title is in package.json.",
      "package.json": '{"name":"mellox-live","description":"Mellox Live Test"}',
    };
    const result = await llmToolLoop({
      route: "geo.agent.implement",
      system: "You investigate repositories. Read files before answering, then submit.",
      tools: [
        {
          name: "read_file",
          description: "Read a file by path.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["path"],
            properties: { path: { type: "string" } },
          },
        },
        {
          name: "submit",
          description: "Submit the product title.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["title"],
            properties: { title: { type: "string" } },
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: "Read README.md, then package.json, then submit the product title.",
        },
      ],
      handleTool: async (name, input) => {
        if (name === "submit") return { content: "ok", summary: "submitted" };
        const path = (input as { path?: string }).path ?? "";
        return { content: files[path] ?? "not found", summary: `read ${path}` };
      },
      terminalTools: ["submit"],
      maxTurns: 6,
      maxCostUsd: 0.5,
      deadlineAt: Date.now() + 150_000,
    });
    console.info(
      `[live] tool loop ${result.status} on ${result.model}, ${result.usage.turns} turns, $${result.usage.costUsd}`,
    );
    expect(result.status).toBe("submitted");
    expect(result.usage.turns).toBeGreaterThanOrEqual(2);
    expect(String((result.submission?.input as { title?: string })?.title)).toContain(
      "Mellox Live Test",
    );
  }, 180_000);

  it("generates one Flare image", async () => {
    const { runWithScope } = await import("@/server/request-context");
    const { generateImage } = await import("@/lib/openrouter-image.server");
    const image = await runWithScope(
      { userId: `live-${Date.now()}`, route: "generate-image" },
      () =>
        generateImage({
          prompt: "A single red apple on a white table, simple product photo",
          budgeted: true,
        }),
    );
    console.info(
      `[live] image ${image.model} ${image.mimeType} ${image.b64.length} b64 chars $${image.costUsd}`,
    );
    expect(image.model).toBe("openai/gpt-image-2.5-flare");
    expect(image.b64.length).toBeGreaterThan(1000);
  }, 180_000);

  videoIt(
    "renders a `draft` video on OpenRouter and downloads it",
    async () => {
      const { openRouterVideoProvider } = await import("@/server/ugc/providers/openrouter.server");
      const { resolveUgcModel } = await import("@/lib/ugc/models");
      const submitted = await openRouterVideoProvider.submit({
        model: resolveUgcModel("draft", "openrouter"),
        prompt: "A steaming cup of coffee on a wooden table, slow push-in, morning light.",
        durationSec: 4,
        aspectRatio: "16:9",
        resolution: "720p",
        audio: false,
        imageUrls: [],
      });
      expect(submitted).toMatchObject({
        ok: true,
        provider: "openrouter",
        providerModel: "google/veo-3.1-lite",
      });
      if (!submitted.ok) return;
      const deadline = Date.now() + 500_000;
      let check = await openRouterVideoProvider.check(submitted.taskId);
      while (check.state === "pending" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10_000));
        check = await openRouterVideoProvider.check(submitted.taskId);
      }
      console.info(`[live] video ${submitted.taskId} → ${check.state}`);
      expect(check.state).toBe("success");
      if (check.state !== "success") return;
      const file = await openRouterVideoProvider.download!(check.videoUrl);
      expect(file?.bytes).toBeGreaterThan(10_000);
      console.info(`[live] video cost $${check.costUsd}, ${file?.bytes} bytes`);
    },
    560_000,
  );
});
