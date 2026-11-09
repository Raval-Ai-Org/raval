import { describe, expect, it } from "vitest";
import { levelFor, levelledUp, localDay, momentum, streakLabel } from "./momentum";

const today = "2026-11-09";

describe("momentum", () => {
  it("has no streak with nothing made", () => {
    const m = momentum({ days: [], total: 0, today });
    expect(m.streak).toBe(0);
    expect(m.atRisk).toBe(false);
    expect(streakLabel(m)).toBe("Start your streak!");
    expect(m.week).toHaveLength(7);
    expect(m.week[6]).toEqual({ day: today, made: false });
  });

  it("counts days in a row ending today", () => {
    const m = momentum({
      days: ["2026-11-09", "2026-11-08", "2026-11-08", "2026-11-07", "2026-11-05"],
      total: 9,
      today,
    });
    expect(m.streak).toBe(3);
    expect(m.madeToday).toBe(true);
    expect(streakLabel(m)).toBe("3 day streak");
    expect(m.week.map((d) => d.made)).toEqual([false, false, true, false, true, true, true]);
  });

  it("keeps yesterday's streak alive but at risk", () => {
    const m = momentum({ days: ["2026-11-08", "2026-11-07"], total: 2, today });
    expect(m.streak).toBe(2);
    expect(m.atRisk).toBe(true);
    expect(streakLabel(m)).toBe("Keep your 2 day streak");
  });

  it("breaks after a missed day", () => {
    expect(momentum({ days: ["2026-11-07"], total: 1, today }).streak).toBe(0);
  });

  it("crosses month and year edges", () => {
    const m = momentum({
      days: ["2027-01-01", "2026-12-31", "2026-12-30"],
      total: 3,
      today: "2027-01-01",
    });
    expect(m.streak).toBe(3);
  });

  it("ignores junk and never counts fewer pieces than days", () => {
    const m = momentum({ days: ["nope", "2026-11-09", "2026-11-08"], total: 0, today });
    expect(m.total).toBe(2);
    expect(m.streak).toBe(2);
  });
});

describe("levels", () => {
  it("climbs 25, 50, 100…", () => {
    expect(levelFor(0)).toMatchObject({ index: 1, from: 0, goal: 25, progress: 0 });
    expect(levelFor(7)).toMatchObject({ index: 1, goal: 25 });
    expect(levelFor(25)).toMatchObject({ index: 2, from: 25, goal: 50, progress: 0 });
    expect(levelFor(75).progress).toBeCloseTo(0.5);
    expect(levelFor(5000)).toMatchObject({ maxed: true, progress: 1 });
  });

  it("levels up only when a goal is crossed", () => {
    expect(levelledUp(24, 25)).toBe(true);
    expect(levelledUp(25, 26)).toBe(false);
    expect(levelledUp(30, 20)).toBe(false);
  });

  it("formats local days", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
