import { describe, expect, it } from "vitest";
import { STUDIO_JOB_TIMEOUT_MS, studioJobIsStale, studioProviderTaskIsTimedOut } from "./recovery";

describe("Studio render recovery", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");

  it("never expires a provider-accepted video because of elapsed time", () => {
    expect(
      studioProviderTaskIsTimedOut(
        { kind: "video", taskId: "provider-video-1", startedAt: now - 7 * 86_400_000 },
        now,
      ),
    ).toBe(false);
  });

  it("retains the bounded timeout for images", () => {
    expect(
      studioProviderTaskIsTimedOut(
        { kind: "image", taskId: "provider-image-1", startedAt: now - 11 * 60_000 },
        now,
      ),
    ).toBe(true);
  });

  it("does not mark a job stale while an accepted provider task is pending", () => {
    expect(
      studioJobIsStale(
        {
          status: "running",
          created_at: new Date(now - STUDIO_JOB_TIMEOUT_MS - 1).toISOString(),
          stage_at: new Date(now - STUDIO_JOB_TIMEOUT_MS - 1).toISOString(),
          provider_tasks: [{ state: "pending" }],
        },
        now,
      ),
    ).toBe(false);
  });

  it("still recovers an abandoned non-render job", () => {
    expect(
      studioJobIsStale(
        {
          status: "running",
          created_at: new Date(now - STUDIO_JOB_TIMEOUT_MS - 1).toISOString(),
          stage_at: new Date(now - STUDIO_JOB_TIMEOUT_MS - 1).toISOString(),
          provider_tasks: [],
        },
        now,
      ),
    ).toBe(true);
  });
});
