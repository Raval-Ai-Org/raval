import { afterEach, describe, expect, it, vi } from "vitest";
import { isProofEngineEnabled } from "./feature-flags";

const WS = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isProofEngineEnabled", () => {
  it("is off by default", () => {
    vi.stubEnv("FEATURE_FLAG_PROOF_ENGINE_ENABLED", "");
    expect(isProofEngineEnabled()).toBe(false);
    expect(isProofEngineEnabled(WS)).toBe(false);
  });

  it("turns on globally", () => {
    vi.stubEnv("FEATURE_FLAG_PROOF_ENGINE_ENABLED", "true");
    expect(isProofEngineEnabled(WS)).toBe(true);
  });

  it("a per-workspace override wins either way", () => {
    vi.stubEnv("FEATURE_FLAG_PROOF_ENGINE_ENABLED", "");
    vi.stubEnv(`FEATURE_FLAG_PROOF_ENGINE_ENABLED_WS_${WS}`, "yes");
    expect(isProofEngineEnabled(WS)).toBe(true);
    expect(isProofEngineEnabled()).toBe(false);

    vi.stubEnv("FEATURE_FLAG_PROOF_ENGINE_ENABLED", "true");
    vi.stubEnv(`FEATURE_FLAG_PROOF_ENGINE_ENABLED_WS_${WS}`, "false");
    expect(isProofEngineEnabled(WS)).toBe(false);
  });
});
