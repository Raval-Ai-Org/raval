import { afterEach, describe, expect, it, vi } from "vitest";
import { logToHelicone, setHeliconeTransport } from "./helicone.server";

type CustomLogPayload = {
  providerRequest: { url: string; json: unknown; meta: Record<string, string> };
  providerResponse: {
    status: number;
    headers: Record<string, string>;
    json: Record<string, unknown>;
  };
  timing: { startTime: unknown; endTime: unknown };
};

afterEach(() => {
  delete process.env.HELICONE_BASE_URL;
  delete process.env.HELICONE_LOG_PROMPTS;
  setHeliconeTransport(null);
});

const baseRow = {
  provider: "anthropic",
  model: "claude-sonnet-5",
  route: "coach.briefing",
  workspace_id: "ws-1",
  user_id: "user-1",
  input_tokens: 120,
  output_tokens: 40,
  est_cost_usd: 0.0021,
  latency_ms: 850,
  status: "ok",
  cached: false,
  truncated: false,
};

describe("logToHelicone", () => {
  it("does nothing when HELICONE_BASE_URL is unset", () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    setHeliconeTransport(transport);

    logToHelicone(baseRow);

    expect(transport).not.toHaveBeenCalled();
  });

  it("sends a custom-log payload with token usage and property metadata when enabled", async () => {
    process.env.HELICONE_BASE_URL = "http://localhost:8585";
    const transport = vi.fn().mockResolvedValue(undefined);
    setHeliconeTransport(transport);

    logToHelicone(baseRow);
    await Promise.resolve();

    expect(transport).toHaveBeenCalledOnce();
    const payload = transport.mock.calls[0][0] as CustomLogPayload;
    expect(payload.providerRequest.json).toEqual({ model: "claude-sonnet-5" });
    expect(payload.providerRequest.meta["Helicone-Property-Provider"]).toBe("anthropic");
    expect(payload.providerRequest.meta["Helicone-Property-Workspace"]).toBe("ws-1");
    expect(payload.providerRequest.meta["Helicone-Property-Total-Tokens"]).toBe("160");
    expect(payload.providerRequest.meta["Helicone-Property-Latency-Ms"]).toBe("850");
    expect(payload.providerResponse.status).toBe(200);
    expect(payload.providerResponse.json.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
    });
    expect(payload.timing.startTime).toBeDefined();
    expect(payload.timing.endTime).toBeDefined();
  });

  it("marks an error row with a 500 provider-response status", async () => {
    process.env.HELICONE_BASE_URL = "http://localhost:8585";
    const transport = vi.fn().mockResolvedValue(undefined);
    setHeliconeTransport(transport);

    logToHelicone({ ...baseRow, status: "error" });
    await Promise.resolve();

    expect((transport.mock.calls[0][0] as CustomLogPayload).providerResponse.status).toBe(500);
  });

  it("never embeds request/response bodies unless HELICONE_LOG_PROMPTS is true", async () => {
    process.env.HELICONE_BASE_URL = "http://localhost:8585";
    const transport = vi.fn().mockResolvedValue(undefined);
    setHeliconeTransport(transport);

    logToHelicone({ ...baseRow, request_body: { messages: ["secret"] } });
    await Promise.resolve();

    expect(
      (transport.mock.calls[0][0] as CustomLogPayload).providerRequest.json,
    ).not.toHaveProperty("messages");
  });

  it("swallows a transport failure instead of throwing", () => {
    process.env.HELICONE_BASE_URL = "http://localhost:8585";
    setHeliconeTransport(vi.fn().mockRejectedValue(new Error("network down")));

    expect(() => logToHelicone(baseRow)).not.toThrow();
  });
});
