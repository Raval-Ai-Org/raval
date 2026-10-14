// Opt-in live validation through Mellox's production gateways:
// node node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/gpt-upgrade.live.ts
// Uses synthetic inputs and captures metering locally; no workspace data is written.
import { loadEnvConfig } from "@next/env";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

loadEnvConfig(process.cwd());

const rows: UsageRecord[] = [];
let restoreSink: (() => void) | undefined;

beforeAll(async () => {
  expect(
    Boolean(process.env.OPENROUTER_API_KEY),
    "OpenRouter key is required for live checks",
  ).toBe(true);
  vi.stubEnv("HELICONE_BASE_URL", "");
  vi.stubEnv("REDIS_URL", "");
  const { setUsageSink } = await import("@/server/ai/metering");
  restoreSink = setUsageSink(async (row) => void rows.push(row));
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => restoreSink?.());

describe.each([
  { model: "openai/gpt-6.1-sol", route: "chat", override: "AI_MODEL_CHAT" },
  {
    model: "openai/gpt-6-luna",
    route: "competitors.updates",
    override: "AI_MODEL_COMPETITORS_UPDATES",
  },
])("$model live compatibility", ({ model, route, override }) => {
  function selectModel() {
    vi.stubEnv("HELICONE_BASE_URL", "");
    vi.stubEnv("REDIS_URL", "");
    // Pin only this test worker so a working Gemini primary can't hide a broken fallback.
    vi.stubEnv(override, model);
  }

  function verifyUsage(start: number) {
    const calls = rows.slice(start);
    expect(calls.length).toBeGreaterThan(0);
    for (const row of calls) {
      expect(row).toMatchObject({ provider: "openrouter", model, status: "ok", truncated: false });
      expect(Number(row.est_cost_usd)).toBeGreaterThan(0);
      expect(Number(row.output_tokens)).toBeGreaterThan(0);
    }
    console.info(
      `[live] ${model}: ${calls.length} call(s), $${calls.reduce((sum, row) => sum + Number(row.est_cost_usd), 0).toFixed(6)}`,
    );
  }

  it("answers plain text and records real provider usage", async () => {
    selectModel();
    const start = rows.length;
    const { chatCompletion } = await import("@/lib/ai-gateway.server");
    const result = await chatCompletion({
      route,
      messages: [{ role: "user", content: "Return exactly this word: READY" }],
      noCache: true,
      temperature: 0.2,
      maxTotalTokens: 1_024,
      retries: 0,
    });
    expect(result._model).toBe(model);
    expect(String(result.choices[0].message.content).trim()).toBe("READY");
    verifyUsage(start);
  });

  it("returns strict structured output with the production privacy setting", async () => {
    selectModel();
    const start = rows.length;
    const { chatCompletion } = await import("@/lib/ai-gateway.server");
    const result = await chatCompletion({
      route,
      messages: [{ role: "user", content: "Extract name and city: Acme Shoes is based in Porto." }],
      noCache: true,
      maxTotalTokens: 1_024,
      retries: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "company",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["name", "city"],
            properties: { name: { type: "string" }, city: { type: "string" } },
          },
        },
      },
    });
    expect(result._model).toBe(model);
    expect(JSON.parse(result.choices[0].message.content)).toEqual({
      name: "Acme Shoes",
      city: "Porto",
    });
    verifyUsage(start);
  });

  it("streams visible text and meters the completed response", async () => {
    selectModel();
    const start = rows.length;
    const { chatCompletionStream } = await import("@/lib/ai-gateway.server");
    const response = await chatCompletionStream({
      route,
      messages: [{ role: "user", content: "Return exactly this word: READY" }],
      maxTotalTokens: 1_024,
    });
    const stream = await response.text();
    expect(stream).toContain("READY");
    expect(stream).toContain("[DONE]");
    expect(stream).not.toContain('"reasoning_details"');
    verifyUsage(start);
  });

  it("completes a tool round trip while replaying the assistant response", async () => {
    selectModel();
    const start = rows.length;
    const handled: string[] = [];
    const { llmToolLoop } = await import("@/lib/ai-gateway.tool-loop.server");
    const result = await llmToolLoop({
      route,
      system: "Call read_code first to obtain the secret code, then call submit with that code.",
      messages: [{ role: "user", content: "Read the code and submit it. Do not guess." }],
      tools: [
        {
          name: "read_code",
          description: "Read the secret code.",
          input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "submit",
          description: "Submit the code you read.",
          input_schema: {
            type: "object",
            properties: { code: { type: "string" } },
            required: ["code"],
            additionalProperties: false,
          },
        },
      ],
      handleTool: async (name) => {
        handled.push(name);
        return { content: name === "read_code" ? "MELLOX-VERIFY-42" : "ok", summary: name };
      },
      terminalTools: ["submit"],
      maxTurns: 3,
      maxTokensPerTurn: 1_500,
      maxCostUsd: 0.05,
      deadlineAt: Date.now() + 55_000,
    });
    expect(result.status).toBe("submitted");
    expect(result.model).toBe(model);
    expect(handled).toEqual(["read_code", "submit"]);
    expect(result.submission?.input).toEqual({ code: "MELLOX-VERIFY-42" });
    expect(result.usage.turns).toBeGreaterThanOrEqual(2);
    verifyUsage(start);
  });
});
