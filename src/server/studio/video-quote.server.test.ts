import { afterEach, expect, it, vi } from "vitest";
import { quoteStudioVideo } from "./video-quote.server";
afterEach(() => {
  vi.unstubAllEnvs();
});
it("quotes from the runtime provider and model without starting a render", () => {
  vi.stubEnv("VIDEO_PROVIDER_STANDARD", "kie");
  const standard = quoteStudioVideo({
    platforms: [],
    videoModelKey: "standard",
    durationSec: 8,
    videoResolution: "720P",
  });
  const economy = quoteStudioVideo({
    platforms: [],
    videoModelKey: "draft",
    durationSec: 8,
    videoResolution: "720P",
  });
  expect(economy.units).toBeLessThanOrEqual(standard.units);
  expect(standard.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(
    quoteStudioVideo({
      platforms: [],
      videoModelKey: "standard",
      durationSec: 20,
      videoResolution: "720P",
    }).units,
  ).toBeGreaterThanOrEqual(standard.units);
});
it("quotes a free video while one is left, then credits, with the meter in the hash", () => {
  vi.stubEnv("VIDEO_PROVIDER_STANDARD", "kie");
  const controls = {
    platforms: [],
    videoModelKey: "standard" as const,
    durationSec: 24,
    videoResolution: "720P" as const,
  };
  const free = quoteStudioVideo(controls, { videoBalance: 200 });
  expect(free).toMatchObject({ meter: "video", units: 100, freeLeft: 2 });
  const paid = quoteStudioVideo(controls, { videoBalance: 50 });
  expect(paid.meter).toBe("credits");
  expect(paid.units % 5).toBe(0);
  expect(paid.freeLeft).toBe(0);
  expect(paid.hash).not.toBe(free.hash);
  // Premium never uses a free video.
  vi.stubEnv("UGC_MODEL_PREMIUM_ENABLED", "true");
  expect(
    quoteStudioVideo(
      { platforms: [], videoModelKey: "premium", durationSec: 10, videoResolution: "1080P" },
      { videoBalance: 1_000 },
    ).meter,
  ).toBe("credits");
});
it("changes the quote when routed provider prices change", () => {
  vi.stubEnv("VIDEO_PROVIDER_STANDARD", "kie");
  const controls = {
    platforms: [],
    videoModelKey: "standard" as const,
    durationSec: 8,
    videoResolution: "720P" as const,
  };
  const before = quoteStudioVideo(controls);
  vi.stubEnv("UGC_PRICE_STANDARD_720P_CREDITS", "300");
  const after = quoteStudioVideo(controls);
  expect(after.hash).not.toBe(before.hash);
  expect(after.units).toBeGreaterThan(before.units);
});
