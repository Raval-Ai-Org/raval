import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kie = vi.hoisted(() => ({ calls: 0, fail: null as Error | null }));

vi.mock("./kie-chat.server", () => ({
  completionAsSse: vi.fn(),
  kieTransport: vi.fn(async () => {
    kie.calls += 1;
    if (kie.fail) throw kie.fail;
    return { model: "kie", choices: [{ message: { role: "assistant", content: "from kie" } }] };
  }),
}));

import { AiGatewayError, answeredBy, sendCompletion } from "./ai-gateway.server";

const opts = { route: "studio.captions", timeoutMs: 5_000, retries: 0 };
const body = { models: ["anthropic/claude-haiku-5.5"], messages: [] };

function openRouterAnswers(status: number, payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status })),
  );
}

beforeEach(() => {
  kie.calls = 0;
  kie.fail = null;
  vi.stubEnv("AI_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
  vi.stubEnv("KIE_API_KEY", "kie-test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendCompletion on OpenRouter", () => {
  it("answers from OpenRouter when it can", async () => {
    openRouterAnswers(200, { choices: [{ message: { role: "assistant", content: "fast" } }] });
    const json = await sendCompletion(body, opts);
    expect(json.choices[0].message.content).toBe("fast");
    expect(kie.calls).toBe(0);
  });

  it("sends the request once to KIE when OpenRouter is out of credits", async () => {
    openRouterAnswers(402, { error: { code: 402, message: "Insufficient credits" } });
    const json = await sendCompletion(body, opts);
    expect(json.choices[0].message.content).toBe("from kie");
    expect(kie.calls).toBe(1);
  });

  it("does not use KIE for other OpenRouter errors", async () => {
    openRouterAnswers(400, { error: { code: 400, message: "bad request" } });
    await expect(sendCompletion(body, opts)).rejects.toBeInstanceOf(AiGatewayError);
    expect(kie.calls).toBe(0);
  });

  it("keeps the 402 when KIE has no key", async () => {
    vi.stubEnv("KIE_API_KEY", "");
    openRouterAnswers(402, { error: { code: 402, message: "Insufficient credits" } });
    await expect(sendCompletion(body, opts)).rejects.toMatchObject({
      code: "insufficient_credits",
    });
    expect(kie.calls).toBe(0);
  });
});

describe("models kept on KIE while OpenRouter is the main provider", () => {
  const sol = { models: ["openai/gpt-6.1-sol", "google/gemini-3.8-flash"], messages: [] };

  it("sends GPT-6.1 Sol to KIE and says so", async () => {
    openRouterAnswers(200, { choices: [{ message: { role: "assistant", content: "or" } }] });
    const json = await sendCompletion(sol, opts);
    expect(json.choices[0].message.content).toBe("from kie");
    expect(answeredBy(json)).toBe("kie");
  });

  it("answers through OpenRouter when KIE fails", async () => {
    kie.fail = new AiGatewayError(502, "Internal error", "provider_error");
    openRouterAnswers(200, { choices: [{ message: { role: "assistant", content: "or" } }] });
    const json = await sendCompletion(sol, opts);
    expect(json.choices[0].message.content).toBe("or");
    expect(answeredBy(json)).toBe("openrouter");
  });

  it("never repeats a KIE timeout the caller asked not to repeat", async () => {
    kie.fail = new AiGatewayError(504, "timed out", "timeout");
    openRouterAnswers(200, { choices: [{ message: { role: "assistant", content: "or" } }] });
    await expect(sendCompletion(sol, { ...opts, retryOnTimeout: false })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("AI_KIE_MODELS=none keeps every model on OpenRouter", async () => {
    vi.stubEnv("AI_KIE_MODELS", "none");
    openRouterAnswers(200, { choices: [{ message: { role: "assistant", content: "or" } }] });
    const json = await sendCompletion(sol, opts);
    expect(json.choices[0].message.content).toBe("or");
    expect(kie.calls).toBe(0);
  });
});
