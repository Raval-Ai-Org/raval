import { describe, expect, it } from "vitest";
import {
  imagesInFlight,
  isSeriesSlot,
  retriesToStart,
  shouldRetryRefusal,
  type RetryTask,
} from "./image-retry";

const t = (slot: string, patch: Partial<RetryTask> = {}): RetryTask => ({
  slot,
  kind: "image",
  taskId: `or-img:${slot}`,
  state: "pending",
  ...patch,
});

describe("image retry", () => {
  it("knows a set's pictures", () => {
    expect(isSeriesSlot("slide:3")).toBe(true);
    expect(isSeriesSlot("frame:0")).toBe(true);
    expect(isSeriesSlot("option:2")).toBe(true);
    expect(isSeriesSlot("main")).toBe(false);
  });

  it("retries balance and rate refusals anywhere", () => {
    const main = t("main");
    for (const code of ["insufficient_credits", "rate_limited"])
      expect(shouldRetryRefusal({ task: main, code })).toBe(true);
  });

  it("retries a safety read that couldn't run only inside a set (the carousel 2 failure)", () => {
    expect(shouldRetryRefusal({ task: t("main"), code: "safety_unavailable" })).toBe(false);
    expect(shouldRetryRefusal({ task: t("slide:2"), code: "safety_unavailable" })).toBe(true);
  });

  it("never retries a refusal by the model or a bad key", () => {
    const frame = t("frame:2");
    for (const code of ["refusal", "invalid_api_key", "missing_api_key"])
      expect(shouldRetryRefusal({ task: frame, code })).toBe(false);
  });

  it("retries any other refusal in a set (the Story bug), not on a single picture", () => {
    expect(shouldRetryRefusal({ task: t("frame:2"), code: "invalid_request" })).toBe(true);
    expect(shouldRetryRefusal({ task: t("slide:4") })).toBe(true);
    expect(shouldRetryRefusal({ task: t("main"), code: "invalid_request" })).toBe(false);
    expect(shouldRetryRefusal({ task: t("main", { kind: "video" }), code: "rate_limited" })).toBe(
      false,
    );
  });

  it("refused pictures never wait for each other (the carousel deadlock)", () => {
    const tasks = [
      t("slide:0", { state: "done" }),
      t("slide:1", { awaitingRetry: true }),
      t("slide:2", { awaitingRetry: true }),
      t("slide:3", { awaitingRetry: true }),
    ];
    expect(imagesInFlight(tasks)).toBe(0);
    expect(retriesToStart(tasks).map((x) => x.slot)).toEqual(["slide:1"]);
  });

  it("waits while a picture is still rendering, and ignores unstarted slides", () => {
    const tasks = [
      t("slide:0"),
      t("slide:1", { awaitingRetry: true }),
      t("slide:2", { anchor: { slot: "slide:0" } }),
    ];
    expect(retriesToStart(tasks)).toEqual([]);
    const lead = [
      t("slide:0", { awaitingRetry: true }),
      t("slide:1", { anchor: { slot: "slide:0" } }),
    ];
    expect(retriesToStart(lead).map((x) => x.slot)).toEqual(["slide:0"]);
  });
});
