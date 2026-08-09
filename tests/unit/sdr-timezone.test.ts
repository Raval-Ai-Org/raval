// T044 — timezone + schedule-window (spec FR-025). A naive local ISO string
// (user's timezone) converts to an absolute UTC instant; schedules must be in
// the future and within 1 year.
import { describe, it, expect } from "vitest";
import { toUtcIso, isScheduleWithinWindow } from "@/lib/sdr.server";

describe("toUtcIso", () => {
  it("converts a naive local ISO string to an absolute UTC instant", () => {
    const utc = toUtcIso("2026-08-10T09:00:00");
    expect(utc.endsWith("Z")).toBe(true);
    // The instant equals the local wall-clock parsed as local time, converted to UTC.
    expect(new Date(utc).getTime()).toBe(new Date("2026-08-10T09:00:00").getTime());
  });

  it("accepts an already-UTC string unchanged", () => {
    expect(toUtcIso("2026-08-10T09:00:00Z")).toBe("2026-08-10T09:00:00.000Z");
  });

  it("throws on an invalid time (PLATFORM_VALIDATION)", () => {
    expect(() => toUtcIso("not-a-date")).toThrow();
  });
});

describe("isScheduleWithinWindow", () => {
  it("accepts a future time within 1 year", () => {
    expect(isScheduleWithinWindow(new Date(Date.now() + 3600_000).toISOString())).toBe(true);
  });

  it("rejects a past time", () => {
    expect(isScheduleWithinWindow(new Date(Date.now() - 1000).toISOString())).toBe(false);
  });

  it("rejects more than 1 year out", () => {
    expect(isScheduleWithinWindow(new Date(Date.now() + 400 * 24 * 3600_000).toISOString())).toBe(false);
  });

  it("rejects a malformed string", () => {
    expect(isScheduleWithinWindow("garbage")).toBe(false);
  });
});
