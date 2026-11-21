import { afterEach, describe, expect, it, vi } from "vitest";
import { imageFundsPaused, kieImagesReady } from "./image-funds.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("image funds pause", () => {
  it("never refuses a picture up front while KIE can draw it", async () => {
    vi.stubEnv("KIE_API_KEY", "kie-test");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { total_credits: 54, total_usage: 52.81 } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(kieImagesReady()).toBe(true);
    expect(await imageFundsPaused()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can be turned off, and with no KIE key it pauses on a low balance", async () => {
    vi.stubEnv("KIE_API_KEY", "kie-test");
    vi.stubEnv("IMAGE_PROVIDER_FALLBACK", "none");
    expect(kieImagesReady()).toBe(false);
    vi.stubEnv("KIE_API_KEY", "");
    vi.stubEnv("IMAGE_PROVIDER_FALLBACK", "");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-low");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: { total_credits: 54, total_usage: 52.81 } })),
    );
    expect(kieImagesReady()).toBe(false);
    expect(await imageFundsPaused()).toBe(true);
  });
});
