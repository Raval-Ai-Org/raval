import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_SONNET_MODEL,
  CLAUDE_OPUS_MODEL,
  claudeTextPrompt,
  selectClaudeModel,
} from "./anthropic-gateway.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("selectClaudeModel", () => {
  it("uses Sonnet by default for normal Brand DNA and marketing coach work", () => {
    expect(selectClaudeModel("brand-dna")).toBe(CLAUDE_SONNET_MODEL);
    expect(selectClaudeModel("marketing-coach")).toBe(CLAUDE_SONNET_MODEL);
  });

  it("escalates to Opus for genuinely deeper strategic analysis", () => {
    expect(selectClaudeModel("deep-strategy", { isComplexStrategy: true })).toBe(CLAUDE_OPUS_MODEL);
  });

  it("omits deprecated sampling parameters from every Claude request", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await claudeTextPrompt({
      route: "brand-extract",
      system: "Return JSON.",
      user: "Extract the brand.",
      model: CLAUDE_SONNET_MODEL,
      maxTokens: 300,
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toEqual({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 300,
      system: "Return JSON.",
      messages: [{ role: "user", content: "Extract the brand." }],
    });
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("top_p");
    expect(request).not.toHaveProperty("top_k");
  });
});

describe("claudeTextPrompt output handling", () => {
  function respond(body: Record<string, unknown>) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const schema = { type: "object", additionalProperties: false, properties: {}, required: [] };

  it("sends effort and the JSON schema through output_config", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = respond({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{}" }],
    });

    await claudeTextPrompt({
      route: "market-intelligence",
      system: "s",
      user: "u",
      model: CLAUDE_OPUS_MODEL,
      maxTokens: 16_000,
      effort: "medium",
      outputSchema: schema,
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.max_tokens).toBe(16_000);
    expect(request.output_config).toEqual({
      effort: "medium",
      format: { type: "json_schema", schema },
    });
  });

  // Regression: Opus 5 thinks by default and thinking shares max_tokens; a cut-off
  // JSON answer used to be returned as if complete and fail downstream parsing.
  it("rejects structured output cut off at max_tokens", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    respond({
      stop_reason: "max_tokens",
      usage: { output_tokens: 3000 },
      content: [{ type: "text", text: '{"summary":"partial' }],
    });

    await expect(
      claudeTextPrompt({
        route: "market-intelligence",
        system: "s",
        user: "u",
        outputSchema: schema,
      }),
    ).rejects.toMatchObject({ code: "max_tokens" });
  });

  it("keeps partial free text at max_tokens for callers without a schema", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    respond({ stop_reason: "max_tokens", content: [{ type: "text", text: "partial prose" }] });

    await expect(claudeTextPrompt({ route: "chat", system: "s", user: "u" })).resolves.toBe(
      "partial prose",
    );
  });

  it("surfaces refusals as their own error", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    respond({ stop_reason: "refusal", content: [] });

    await expect(
      claudeTextPrompt({ route: "market-intelligence", system: "s", user: "u" }),
    ).rejects.toMatchObject({ code: "refusal", status: 422 });
  });
});
