import { afterEach, describe, expect, it } from "vitest";
import { resolveTextRoute, unifiedGatewayEnabled, type RouteCandidate } from "./text-routes.server";

const DEFAULT: RouteCandidate = { provider: "openrouter", model: "qwen/qwen3-max" };

const ENV_KEYS = [
  "AI_TEXT_ROUTE_CHAT_PROVIDER",
  "AI_TEXT_ROUTE_CHAT_MODEL",
  "AI_TEXT_ROUTE_CHAT_FALLBACKS",
  "FEATURE_FLAG_UNIFIED_GATEWAY_ENABLED",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("resolveTextRoute", () => {
  it("resolves to exactly the caller's default when nothing is configured", () => {
    expect(resolveTextRoute("chat", DEFAULT)).toEqual({ primary: DEFAULT, fallbacks: [] });
  });

  it("overrides the primary candidate from PROVIDER/MODEL env vars", () => {
    process.env.AI_TEXT_ROUTE_CHAT_PROVIDER = "anthropic";
    process.env.AI_TEXT_ROUTE_CHAT_MODEL = "claude-sonnet-5";
    expect(resolveTextRoute("chat", DEFAULT)).toEqual({
      primary: { provider: "anthropic", model: "claude-sonnet-5" },
      fallbacks: [],
    });
  });

  it("parses a comma-separated provider:model fallback list", () => {
    process.env.AI_TEXT_ROUTE_CHAT_FALLBACKS =
      "anthropic:claude-sonnet-5, openrouter:google/gemini-2.5-flash";
    expect(resolveTextRoute("chat", DEFAULT)).toEqual({
      primary: DEFAULT,
      fallbacks: [
        { provider: "anthropic", model: "claude-sonnet-5" },
        { provider: "openrouter", model: "google/gemini-2.5-flash" },
      ],
    });
  });

  it("drops an unparsable fallback entry and de-dupes against the primary", () => {
    process.env.AI_TEXT_ROUTE_CHAT_FALLBACKS =
      "not-a-candidate, openrouter:qwen/qwen3-max, anthropic:claude-sonnet-5";
    expect(resolveTextRoute("chat", DEFAULT)).toEqual({
      primary: DEFAULT,
      fallbacks: [{ provider: "anthropic", model: "claude-sonnet-5" }],
    });
  });
});

describe("unifiedGatewayEnabled", () => {
  it("defaults to enabled", () => {
    expect(unifiedGatewayEnabled()).toBe(true);
  });

  it('is disabled only by an explicit "false"', () => {
    process.env.FEATURE_FLAG_UNIFIED_GATEWAY_ENABLED = "false";
    expect(unifiedGatewayEnabled()).toBe(false);
  });
});
