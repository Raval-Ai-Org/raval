import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("health diagnostics", () => {
  it("reports OpenRouter and video provider readiness without secrets", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-secret-value");
    vi.stubEnv("VIDEO_PROVIDER", "openrouter");
    const body = await GET().json();

    expect(body.ai).toEqual({ provider: "openrouter", configured: true });
    expect(body.image).toEqual(expect.objectContaining({ provider: "openrouter" }));
    expect(body.video).toEqual(expect.objectContaining({ provider: "openrouter", fallback: null }));
    expect(body.services).toEqual(
      expect.objectContaining({ text: true, imageGeneration: true, videoGeneration: true }),
    );
    expect(JSON.stringify(body)).not.toContain("sk-or-secret-value");
  });

  it("is degraded without an OpenRouter key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const body = await GET().json();
    expect(body.status).toBe("degraded");
    expect(body.services.imageGeneration).toBe(false);
  });
});
