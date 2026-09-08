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
