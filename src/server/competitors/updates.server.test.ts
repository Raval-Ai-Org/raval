import { describe, expect, it } from "vitest";
import { lookbackDays, updateFingerprint } from "./updates.server";
import { nextCheckAt } from "./service.server";

const NOW = Date.parse("2026-09-23T12:00:00Z");

describe("lookbackDays", () => {
  it("looks back a month the first time a competitor is checked", () => {
    expect(lookbackDays(null, NOW)).toBe(30);
  });

  it("asks only for what happened since the last check", () => {
    const yesterday = new Date(NOW - 86_400_000).toISOString();
    expect(lookbackDays(yesterday, NOW)).toBe(1);
    const fourDaysAgo = new Date(NOW - 4 * 86_400_000).toISOString();
    expect(lookbackDays(fourDaysAgo, NOW)).toBe(4);
  });

  it("never backfills more than a month and a half after a long pause", () => {
    const lastYear = new Date(NOW - 400 * 86_400_000).toISOString();
    expect(lookbackDays(lastYear, NOW)).toBe(45);
  });

  it("asks for a single day when the clock is ahead of the last check", () => {
    const future = new Date(NOW + 86_400_000).toISOString();
    expect(lookbackDays(future, NOW)).toBe(1);
  });

  it("falls back to the default when the stored timestamp is unusable", () => {
    expect(lookbackDays("not a date", NOW)).toBe(30);
  });
});

describe("updateFingerprint", () => {
  it("gives the same identity to the same story found twice", () => {
    const a = updateFingerprint("https://news.com/story?utm_source=x", "Rival launches a new plan");
    const b = updateFingerprint("https://www.news.com/story/", "Rival launches a new plan!");
    expect(a).toBe(b);
  });

  it("separates two different stories from the same outlet", () => {
    const a = updateFingerprint("https://news.com/one", "Rival raises funding");
    const b = updateFingerprint("https://news.com/two", "Rival cuts prices");
    expect(a).not.toBe(b);
  });

  it("separates the same URL reported with a materially different headline", () => {
    const a = updateFingerprint("https://news.com/x", "Rival raises funding");
    const b = updateFingerprint("https://news.com/x", "Rival shuts down");
    expect(a).not.toBe(b);
  });
});

describe("nextCheckAt", () => {
  it("looks again tomorrow when something actually happened", () => {
    const next = Date.parse(nextCheckAt({ foundSomething: true, quietSweeps: 3, now: NOW }));
    expect(next - NOW).toBe(24 * 3600_000);
  });

  it("backs off further the longer a competitor stays quiet", () => {
    const first = Date.parse(nextCheckAt({ foundSomething: false, quietSweeps: 0, now: NOW }));
    const later = Date.parse(nextCheckAt({ foundSomething: false, quietSweeps: 2, now: NOW }));
    expect(later).toBeGreaterThan(first);
  });

  it("settles at weekly rather than backing off forever", () => {
    const capped = Date.parse(nextCheckAt({ foundSomething: false, quietSweeps: 99, now: NOW }));
    expect(capped - NOW).toBe(168 * 3600_000);
  });
});
