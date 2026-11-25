import { afterEach, describe, expect, it, vi } from "vitest";
import { completionAsSse, kieModelChain, kieTargetFor, kieTransport } from "./kie-chat.server";

vi.mock("server-only", () => ({}));

describe("KIE model mapping", () => {
  it("maps the tier models to KIE's APIs", () => {
    expect(kieTargetFor("anthropic/claude-haiku-5.5")).toMatchObject({
      api: "claude",
      model: "claude-haiku-5-5",
    });
    expect(kieTargetFor("google/gemini-4-carbon")).toMatchObject({ api: "gemini" });
    expect(kieTargetFor("openai/gpt-6.1-sol")).toMatchObject({
      api: "codex",
      model: "gpt-6-1-sol",
    });
  });

  it("stands in for models KIE does not carry", () => {
    expect(kieTargetFor("openai/gpt-6-luna").id).toBe("google/gemini-3.8-flash");
    expect(kieTargetFor("z-ai/glm-5.3-flash").model).toBe("deepseek-v4-1-flash");
  });

  it("ends every chain on the safety net without repeats", () => {
    const chain = kieModelChain(["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"]);
    expect(chain.map((t) => t.id)).toEqual([
      "anthropic/claude-haiku-5.5",
      "google/gemini-3.8-flash",
      "openai/gpt-6.1-sol",
    ]);
  });

  it("asks GPT-6.1 Sol before Gemini when there are pictures", () => {
    const chain = kieModelChain(["google/gemini-3.8-flash"], { images: true });
    expect(chain.map((t) => t.id)).toEqual(["openai/gpt-6.1-sol", "google/gemini-3.8-flash"]);
    const heard = kieModelChain(["google/gemini-3.8-flash"], { images: true, audio: true });
    expect(heard[0].id).toBe("google/gemini-3.8-flash");
  });
});

describe("kieTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("falls back past a failing Claude and reports the answering model", async () => {
    vi.stubEnv("KIE_API_KEY", "kie-test");
    vi.stubEnv("KIE_USD_PER_CREDIT", "0.005");
    const urls: string[] = [];
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        urls.push(url);
        bodies.push(JSON.parse(String(init.body)));
        if (url.includes("/claude/")) {
          return new Response(
            JSON.stringify({
              type: "error",
              error: { type: "api_error", message: "Internal error" },
            }),
            { status: 500 },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "stop", message: { role: "assistant", content: '{"ok":true}' } },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 3 },
            credits_consumed: 2,
          }),
        );
      }),
    );
    const answer = await kieTransport(
      {
        models: ["anthropic/claude-haiku-5.5"],
        messages: [
          { role: "system", content: "You read brands." },
          { role: "user", content: "Hi" },
        ],
        max_tokens: 500,
        response_format: {
          type: "json_schema",
          json_schema: { name: "x", schema: { type: "object" } },
        },
      },
      { route: "test", timeoutMs: 10_000 },
    );
    // Claude twice (its intermittent 500s get a second go), then Gemini.
    expect(urls.filter((u) => u.includes("/claude/"))).toHaveLength(2);
    expect(urls.at(-1)).toContain("/gemini-3-8-flash-openai/v1/chat/completions");
    const gemini = bodies.at(-1);
    expect(gemini.response_format).toBeUndefined();
    expect(gemini.messages[0].content).toContain("JSON Schema");
    expect(answer.model).toBe("google/gemini-3.8-flash");
    expect(answer.choices[0].message.content).toBe('{"ok":true}');
    expect(answer.usage.cost).toBeCloseTo(0.01);
  });

  it("translates Responses tool calls back to chat tool_calls", async () => {
    vi.stubEnv("KIE_API_KEY", "kie-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "function_call",
                  call_id: "c1",
                  name: "get_weather",
                  arguments: '{"city":"Paris"}',
                },
              ],
              usage: { input_tokens: 5, output_tokens: 2 },
            }),
          ),
      ),
    );
    const answer = await kieTransport(
      {
        models: ["openai/gpt-6.1-sol"],
        messages: [{ role: "user", content: "Weather?" }],
        tools: [
          { type: "function", function: { name: "get_weather", parameters: { type: "object" } } },
        ],
      },
      { route: "test", timeoutMs: 10_000 },
    );
    expect(answer.choices[0].finish_reason).toBe("tool_calls");
    expect(answer.choices[0].message.tool_calls[0]).toMatchObject({
      id: "c1",
      function: { name: "get_weather", arguments: '{"city":"Paris"}' },
    });
  });

  it("stops at once when KIE is out of credits", async () => {
    vi.stubEnv("KIE_API_KEY", "kie-test");
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ code: 402, msg: "Credits insufficient" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      kieTransport(
        { models: ["google/gemini-3.8-flash"], messages: [{ role: "user", content: "Hi" }] },
        { route: "test", timeoutMs: 10_000 },
      ),
    ).rejects.toMatchObject({ code: "insufficient_credits" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("completionAsSse", () => {
  it("emits OpenAI-shape chunks ending in [DONE]", async () => {
    const text = await new Response(
      completionAsSse({
        id: "x",
        model: "google/gemini-3.8-flash",
        choices: [{ finish_reason: "stop", message: { content: "Hello there" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    ).text();
    expect(text).toContain('"content":"Hello there"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });
});
