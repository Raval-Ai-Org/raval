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
