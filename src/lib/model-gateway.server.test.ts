import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/server/upstream";
import {
  isFailoverSafe,
  routeText,
  setUnifiedProviderCallers,
  unifiedChatCompletion,
} from "./model-gateway.server";

const ENV_KEYS = [
  "AI_TEXT_ROUTE_CHAT_PROVIDER",
  "AI_TEXT_ROUTE_CHAT_MODEL",
  "AI_TEXT_ROUTE_CHAT_FALLBACKS",
  "FEATURE_FLAG_UNIFIED_GATEWAY_ENABLED",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  setUnifiedProviderCallers(null);
});

function upstream(status: number, code?: string): UpstreamError {
  return new UpstreamError(status, "boom", { provider: "test", code });
}

describe("unifiedChatCompletion", () => {
  it("calls the default candidate directly when nothing is configured", async () => {
    const openrouter = vi.fn().mockResolvedValue({
      text: "hi",
      provider: "openrouter",
      model: "qwen/qwen3-max",
      truncated: false,
      degraded: false,
    });
    setUnifiedProviderCallers({ openrouter });

    const result = await unifiedChatCompletion({
      kind: "chat",
      route: "test.route",
      system: "s",
      user: "u",
    });

    expect(result.provider).toBe("openrouter");
    expect(openrouter).toHaveBeenCalledOnce();
  });

  it("fails over to the next candidate on a failover-safe error", async () => {
    process.env.AI_TEXT_ROUTE_CHAT_FALLBACKS = "anthropic:claude-sonnet-5";
    const openrouter = vi.fn().mockRejectedValue(upstream(503));
    const anthropic = vi.fn().mockResolvedValue({
      text: "ok",
      provider: "anthropic",
      model: "claude-sonnet-5",
      truncated: false,
      degraded: false,
    });
    setUnifiedProviderCallers({ openrouter, anthropic });

    const result = await unifiedChatCompletion({
      kind: "chat",
      route: "test.route",
      system: "s",
      user: "u",
    });

    expect(result.provider).toBe("anthropic");
    expect(openrouter).toHaveBeenCalledOnce();
    expect(anthropic).toHaveBeenCalledOnce();
  });

  it("does not fail over on a non-failover-safe error, and never calls the next candidate", async () => {
    process.env.AI_TEXT_ROUTE_CHAT_FALLBACKS = "anthropic:claude-sonnet-5";
    const openrouter = vi.fn().mockRejectedValue(upstream(502, "malformed_response"));
    const anthropic = vi.fn();
    setUnifiedProviderCallers({ openrouter, anthropic });

    await expect(
      unifiedChatCompletion({ kind: "chat", route: "test.route", system: "s", user: "u" }),
    ).rejects.toMatchObject({ code: "malformed_response" });
    expect(anthropic).not.toHaveBeenCalled();
  });

  it("throws the last error once every candidate is exhausted", async () => {
    process.env.AI_TEXT_ROUTE_CHAT_FALLBACKS = "anthropic:claude-sonnet-5";
    const openrouter = vi.fn().mockRejectedValue(upstream(503));
    const anthropic = vi.fn().mockRejectedValue(upstream(504));
    setUnifiedProviderCallers({ openrouter, anthropic });

    await expect(
      unifiedChatCompletion({ kind: "chat", route: "test.route", system: "s", user: "u" }),
    ).rejects.toMatchObject({ status: 504 });
  });

  it("skips routing entirely when the feature flag is off", async () => {
    process.env.FEATURE_FLAG_UNIFIED_GATEWAY_ENABLED = "false";
    process.env.AI_TEXT_ROUTE_CHAT_FALLBACKS = "anthropic:claude-sonnet-5";
    const openrouter = vi.fn().mockResolvedValue({
      text: "hi",
      provider: "openrouter",
      model: "qwen/qwen3-max",
      truncated: false,
      degraded: false,
    });
    const anthropic = vi.fn();
    setUnifiedProviderCallers({ openrouter, anthropic });

    await unifiedChatCompletion({ kind: "chat", route: "test.route", system: "s", user: "u" });

    expect(anthropic).not.toHaveBeenCalled();
  });
});

describe("isFailoverSafe", () => {
  it("treats 401/403/429/5xx as safe to retry on another candidate", () => {
    for (const status of [401, 403, 429, 500, 502, 503, 504, 529]) {
      expect(isFailoverSafe(upstream(status))).toBe(true);
    }
  });

  it("treats a malformed-but-possibly-generated reply as unsafe to retry", () => {
    expect(isFailoverSafe(upstream(502, "malformed_response"))).toBe(false);
  });

  it("treats a non-UpstreamError as unsafe to retry", () => {
    expect(isFailoverSafe(new Error("nope"))).toBe(false);
  });
});

describe("routeText", () => {
  it("reports the resolved plan for a kind without making any call", () => {
    expect(routeText("chat")).toEqual({
      primary: { provider: "openrouter", model: "qwen/qwen3-max" },
      fallbacks: [],
    });
  });
});
