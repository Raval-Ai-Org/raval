import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const budget = vi.hoisted(() => ({ mode: "ok" as "ok" | "degrade" | "block" }));
const usage = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/server/ai/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/budget")>();
  return { ...actual, checkBudget: vi.fn(async () => ({ mode: budget.mode, reason: "limit" })) };
});
vi.mock("@/server/ai/metering", () => ({
  recordUsage: (row: Record<string, unknown>) => usage.rows.push(row),
}));

import {
  chatCompletion,
  llmJson,
  llmText,
  mapOpenRouterError,
  setLlmTransport,
  tokenCeiling,
  withPromptCache,
} from "./ai-gateway.server";
import { ECONOMY, planFor, PREMIUM, WORKHORSE } from "@/server/ai/task-models";

type Reply = { content?: string | null; finish?: string; model?: string; refusal?: string };

function scripted(replies: Reply[]) {
  const bodies: Record<string, any>[] = [];
  const restore = setLlmTransport(async (body) => {
    bodies.push(JSON.parse(JSON.stringify(body)));
    const r = replies.shift() ?? { content: "ok" };
    return {
      model: r.model ?? (body.models as string[])[0],
      choices: [
        {
          finish_reason: r.finish ?? "stop",
          message: { role: "assistant", content: r.content ?? null, refusal: r.refusal ?? null },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.0042 },
    };
  });
  return { bodies, restore };
}

let restore: (() => void) | null = null;
beforeEach(() => {
  budget.mode = "ok";
  usage.rows = [];
});
afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllEnvs();
});

const msgs = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "hi" },
];

describe("chatCompletion request body", () => {
  it("sends the plan's models as a fallback array, its effort and the privacy setting", async () => {
    const s = scripted([{ content: "hello" }]);
    restore = s.restore;
    await chatCompletion({ route: "brand-extract", messages: msgs, noCache: true });
    const body = s.bodies[0];
    expect(body.models).toEqual([PREMIUM, WORKHORSE]);
    expect(body).not.toHaveProperty("model");
    expect(body.reasoning).toEqual({ effort: "medium", exclude: true });
    expect(body.provider).toEqual({ data_collection: "deny" });
    expect(body.usage).toEqual({ include: true });
    // Reasoning shares max_tokens: the plan's 12,000 ceiling applies.
    expect(body.max_tokens).toBeGreaterThanOrEqual(12_000);
  });

  it("meters the model that actually answered, with OpenRouter's own cost", async () => {
    const s = scripted([{ content: "hi", model: WORKHORSE }]);
    restore = s.restore;
    const json = await chatCompletion({ route: "brand-extract", messages: msgs, noCache: true });
    expect(json._model).toBe(WORKHORSE);
    expect(usage.rows[0]).toMatchObject({
      provider: "openrouter",
      model: WORKHORSE,
      route: "brand-extract",
      estCostUsd: 0.0042,
      outputTokens: 20,
    });
  });

  it("requires parameters and drops temperature for a JSON schema, never forces tools", async () => {
    const s = scripted([{ content: "{}" }, { content: null }]);
    restore = s.restore;
    await chatCompletion({
      route: "studio.ideas",
      messages: msgs,
      noCache: true,
      response_format: {
        type: "json_schema",
        json_schema: { name: "x", strict: true, schema: { type: "object" } },
      },
    });
    expect(s.bodies[0].provider).toEqual({ data_collection: "deny", require_parameters: true });
    expect(s.bodies[0]).not.toHaveProperty("temperature");

    await chatCompletion({
      route: "clarify",
      messages: msgs,
      tools: [{ type: "function", function: { name: "t", parameters: {} } }],
    });
    expect(s.bodies[1].tool_choice).toBe("auto");
    expect(s.bodies[1].provider.require_parameters).toBe(true);
  });

  it("keeps a plain call's temperature (the plan's when the caller sets none)", async () => {
    const s = scripted([{ content: "a" }]);
    restore = s.restore;
    await chatCompletion({ route: "studio.ideas", messages: msgs, noCache: true });
    expect(s.bodies[0].temperature).toBe(0.9);
  });

  it("uses the degraded plan past the spend ceiling", async () => {
    budget.mode = "degrade";
    const s = scripted([{ content: "a" }]);
    restore = s.restore;
    const json = await chatCompletion({ route: "chat", messages: msgs, noCache: true });
    expect(s.bodies[0].models[0]).toBe(ECONOMY);
    expect(json._degraded).toBe(true);
    expect(s.bodies[0].max_tokens).toBeLessThanOrEqual(1_000 + 2_048);
    expect(usage.rows[0].status).toBe("degraded");
  });

  it("applies escalation and env overrides", async () => {
    vi.stubEnv("AI_MODEL_UGC_NOTES", "vendor/custom");
    const s = scripted([{ content: "a" }, { content: "b" }]);
    restore = s.restore;
    await chatCompletion({ route: "ugc.notes", messages: msgs, noCache: true });
    expect(s.bodies[0].models).toEqual(["vendor/custom"]);
    await chatCompletion({ route: "chat.pro", messages: msgs, noCache: true, escalate: true });
    expect(s.bodies[1].reasoning.effort).toBe("medium");
  });
});

describe("prompt caching and token ceilings", () => {
  it("marks the end of the leading system block for Anthropic models only", () => {
    const three = [
      { role: "system" as const, content: "identity" },
      { role: "system" as const, content: "brand" },
      { role: "user" as const, content: "q" },
    ];
    const marked = withPromptCache(three, PREMIUM);
    expect(JSON.stringify(marked[1])).toContain("cache_control");
    expect(JSON.stringify(marked[0])).not.toContain("cache_control");
    expect(withPromptCache(three, WORKHORSE)).toBe(three);
  });

  it("adds reasoning headroom to the answer size", () => {
    const plan = planFor("content.generateBatch"); // medium effort
    expect(tokenCeiling({ requested: 1_000, task: "generate", plan, degraded: false })).toBe(
      1_000 + 6_144,
    );
    expect(
      tokenCeiling({
        total: 16_000,
        task: "generate",
        plan: planFor("geo.fix.propose"),
        degraded: false,
      }),
    ).toBe(16_000);
  });
});

describe("llmText / llmJson", () => {
  it("returns humanized text and the answering model", async () => {
    const s = scripted([{ content: "A plain line — no dash.", model: WORKHORSE }]);
    restore = s.restore;
    const r = await llmText({ route: "ugc.notes", system: "s", user: "u" });
    expect(r.model).toBe(WORKHORSE);
    expect(r.text).not.toContain("—");
  });

  it("sends images as data-URL image parts", async () => {
    const s = scripted([{ content: "a logo" }]);
    restore = s.restore;
    await llmText({
      route: "brand-kit/describe",
      system: "s",
      user: "describe",
      images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }],
    });
    const content = s.bodies[0].messages[1].content;
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
    });
  });

  it("maps a refusal and a cut-off structured answer to distinct codes", async () => {
    let s = scripted([{ content: null, finish: "content_filter" }]);
    restore = s.restore;
    await expect(llmText({ route: "ugc.notes", system: "s", user: "u" })).rejects.toMatchObject({
      code: "refusal",
    });
    restore();
    s = scripted([{ content: '{"a":', finish: "length" }]);
    restore = s.restore;
    await expect(
      llmText({ route: "ugc.notes", system: "s", user: "u", outputSchema: { type: "object" } }),
    ).rejects.toMatchObject({ code: "max_tokens" });
  });

  it("retries a cut-off schema answer once with twice the ceiling", async () => {
    const s = scripted([{ content: '{"a":', finish: "length" }, { content: '{"a":1}' }]);
    restore = s.restore;
    const out = await llmJson({
      route: "experiments.values",
      system: "s",
      user: "u",
      maxTokens: 9_000,
      outputSchema: { type: "object" },
      fallback: { a: 0 },
    });
    expect(out).toEqual({ a: 1 });
    expect(s.bodies[1].max_tokens).toBe(18_000);
    expect(s.bodies[0].response_format.type).toBe("json_schema");
  });
});

describe("mapOpenRouterError", () => {
  it("gives each actionable failure its own code", () => {
    expect(mapOpenRouterError(401, "").code).toBe("invalid_api_key");
    const credits = mapOpenRouterError(402, '{"error":{"message":"Insufficient credits"}}');
    expect(credits.code).toBe("insufficient_credits");
    expect(credits.message).toMatch(/add credits in OpenRouter/i);
    expect(mapOpenRouterError(429, "").code).toBe("rate_limited");
    expect(
      mapOpenRouterError(
        404,
        '{"error":{"message":"No endpoints found matching your data policy"}}',
      ).code,
    ).toBe("no_endpoints");
    expect(mapOpenRouterError(503, "upstream down").code).toBe("provider_error");
    expect(
      mapOpenRouterError(
        400,
        '{"error":{"message":"too long","metadata":{"error_type":"context_length_exceeded"}}}',
      ).code,
    ).toBe("context_exceeded");
  });
});

describe("mid-answer provider failures", () => {
  it("never returns partial content from finish_reason error, and retries once", async () => {
    const s = scripted([
      { content: '{"name": "Boy', finish: "error" },
      { content: '{"name":"Boy Brow"}' },
    ]);
    restore = s.restore;
    const r = await llmText({
      route: "ugc.product.extract",
      system: "s",
      user: "u",
      outputSchema: { type: "object" },
    });
    expect(JSON.parse(r.text)).toEqual({ name: "Boy Brow" });
    expect(s.bodies).toHaveLength(2);
    expect(usage.rows[0].status).toBe("error");
  });

  it("surfaces a provider error when the retry fails the same way", async () => {
    const s = scripted([
      { content: "{", finish: "error" },
      { content: "{", finish: "error" },
    ]);
    restore = s.restore;
    await expect(llmText({ route: "ugc.notes", system: "s", user: "u" })).rejects.toMatchObject({
      code: "provider_error",
    });
  });
});
