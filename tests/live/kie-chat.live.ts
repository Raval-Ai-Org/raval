// Live check of the KIE text transport (src/lib/kie-chat.server.ts). Opt-in,
// a few cents of KIE credits:
//   npx vitest run --config vitest.live.config.ts tests/live/kie-chat.live.ts
// One call per tier through the real gateway, a JSON-schema call (Brand DNA's
// route), a picture read, a tool call, and the streaming chat path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive = process.env.KIE_API_KEY?.trim() ? describe : describe.skip;

// A 64×64 red PNG.
const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeUlEQVR4nO3PQQkAMAzAwIqof2UTMxF7HINABFzm7H7dcEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFj12qxUDxeFqrFAAAAABJRU5ErkJggg==";

describeLive("KIE text transport (live)", () => {
  const rows: UsageRecord[] = [];
  let restoreSink: (() => void) | null = null;

  beforeAll(async () => {
    process.env.AI_PROVIDER = "kie";
    const { setUsageSink } = await import("@/server/ai/metering");
    restoreSink = setUsageSink(async (row) => {
      rows.push(row);
    });
  });
  afterAll(() => {
    restoreSink?.();
    console.table(
      rows.map((r) => ({
        route: r.route,
        model: r.model,
        status: r.status,
        usd: r.estCostUsd ?? (r as unknown as { est_cost_usd?: number }).est_cost_usd,
      })),
    );
  });

  it.each([
    ["writer (Haiku)", "studio.social"],
    ["conversation (Sonnet)", "chat.pro"],
    ["analyst (GPT-6.1 Sol)", "brand-extract"],
    ["workhorse (Gemini 3.8 Flash)", "studio.image.review"],
    ["premium (Gemini 4 Carbon)", "geo.agent.review"],
    ["luna stand-in", "chat.history-summary"],
    ["budget (DeepSeek)", "agent.content-fit"],
  ])(
    "answers on the %s tier",
    async (_tier, route) => {
      const { llmText } = await import("@/lib/ai-gateway.server");
      const out = await llmText({
        route,
        system: "Be brief.",
        user: "Reply with the single word: ready",
        maxTokens: 50,
        noCache: true,
      } as never);
      expect(out.text.toLowerCase()).toContain("ready");
    },
    240_000,
  );

  it("returns schema-shaped JSON on the Brand DNA route", async () => {
    const { llmJson } = await import("@/lib/ai-gateway.server");
    const out = await llmJson<{ name: string; colors: string[] }>({
      route: "brand-extract",
      system: "You read brands.",
      user: "The brand Acme Bakery uses red and cream. Give its name and colours.",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "colors"],
        properties: {
          name: { type: "string" },
          colors: { type: "array", items: { type: "string" } },
        },
      },
      fallback: { name: "", colors: [] },
      noCache: true,
    } as never);
    expect(out.name.toLowerCase()).toContain("acme");
    expect(out.colors.length).toBeGreaterThan(0);
  }, 240_000);

  it("reads a picture", async () => {
    const { llmText } = await import("@/lib/ai-gateway.server");
    const out = await llmText({
      route: "studio.image.review",
      system: "Be brief.",
      user: "What single colour fills this image? One word.",
      images: [{ mediaType: "image/png", data: RED_PNG }],
      maxTokens: 50,
      noCache: true,
    } as never);
    expect(out.text.toLowerCase()).toContain("red");
  }, 240_000);

  it("calls a tool", async () => {
    const { chatCompletion } = await import("@/lib/ai-gateway.server");
    const json = await chatCompletion({
      route: "chat.pro",
      messages: [{ role: "user", content: "What is the weather in Paris? Use the tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ],
      noCache: true,
    });
    const call = json.choices[0].message.tool_calls?.[0];
    expect(call?.function.name).toBe("get_weather");
    expect(JSON.parse(call.function.arguments).city).toMatch(/paris/i);
  }, 240_000);

  it("streams a chat reply as OpenAI SSE", async () => {
    const { chatCompletionStream } = await import("@/lib/ai-gateway.server");
    const res = await chatCompletionStream({
      route: "chat",
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    const text = await res.text();
    expect(text).toContain("data: [DONE]");
    expect(text.toLowerCase()).toContain("ready");
  }, 240_000);
});
