import { describe, expect, it } from "vitest";
import { computeFixImpact, MIN_CHECKS, type ImpactCheck } from "./fix-impact";

const NOW = Date.parse("2026-10-20T00:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const checks = (
  n: number,
  daysAgo: number,
  mentioned: boolean,
  position: number | null = null,
): ImpactCheck[] => Array.from({ length: n }, () => ({ at: day(daysAgo), mentioned, position }));

describe("computeFixImpact", () => {
  it("says nothing when no fix is live", () => {
    const impact = computeFixImpact({
      scans: [{ at: day(3), score: 70, scoreVersion: 2 }],
      fixes: [],
      checks: checks(10, 2, true),
      now: NOW,
    });
    expect(impact.firstFixAt).toBeNull();
    expect(impact.score).toBeNull();
    expect(impact.mentions).toBeNull();
  });

  it("compares the last scan before the first fix with the newest after it", () => {
    const impact = computeFixImpact({
      scans: [
        { at: day(30), score: 50, scoreVersion: 2 },
        { at: day(12), score: 58, scoreVersion: 2 },
        { at: day(5), score: 71, scoreVersion: 2 },
        { at: day(1), score: 76, scoreVersion: 2 },
      ],
      fixes: [
        { liveAt: day(10), state: "verified" },
        { liveAt: day(4), state: "checking" },
      ],
      checks: [],
      now: NOW,
    });
    expect(impact.firstFixAt).toBe(day(10));
    expect(impact.score).toMatchObject({ before: 58, after: 76 });
    expect(impact.fixes).toEqual({ live: 2, verified: 1, checking: 1, notFixed: 0 });
    expect(impact.waiting).toEqual({ scan: false, checks: true });
  });

  it("never compares scores from different score versions", () => {
    const impact = computeFixImpact({
      scans: [
        { at: day(12), score: 58, scoreVersion: 1 },
        { at: day(1), score: 76, scoreVersion: 2 },
      ],
      fixes: [{ liveAt: day(10), state: "live" }],
      checks: [],
      now: NOW,
    });
    expect(impact.score).toBeNull();
  });

  it("waits for a scan after the fix", () => {
    const impact = computeFixImpact({
      scans: [{ at: day(12), score: 58, scoreVersion: 2 }],
      fixes: [{ liveAt: day(10), state: "live" }],
      checks: [],
      now: NOW,
    });
    expect(impact.score).toBeNull();
    expect(impact.waiting.scan).toBe(true);
  });

  it("shows a mention rate only with enough answers on both sides", () => {
    const fixes = [{ liveAt: day(10), state: "verified" as const }];
    const thin = computeFixImpact({
      scans: [],
      fixes,
      checks: [...checks(MIN_CHECKS, 15, false), ...checks(MIN_CHECKS - 1, 2, true)],
      now: NOW,
    });
    expect(thin.mentions).toBeNull();

    const enough = computeFixImpact({
      scans: [],
      fixes,
      checks: [
        ...checks(8, 15, false),
        ...checks(2, 14, true, 4),
        ...checks(4, 2, false),
        ...checks(6, 1, true, 2),
        // Too old to count as "before".
        ...checks(20, 60, true, 1),
      ],
      now: NOW,
    });
    expect(enough.mentions).toEqual({ before: 0.2, after: 0.6, checksBefore: 10, checksAfter: 10 });
    // Only two placed answers before: no position is claimed.
    expect(enough.position).toBeNull();
  });

  it("averages the place in the answer when there are enough placed answers", () => {
    const impact = computeFixImpact({
      scans: [],
      fixes: [{ liveAt: day(10), state: "verified" }],
      checks: [...checks(5, 15, true, 4), ...checks(5, 2, true, 2)],
      now: NOW,
    });
    expect(impact.position).toEqual({ before: 4, after: 2 });
  });
});
