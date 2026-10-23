import { describe, expect, it } from "vitest";
import { buildOverviewActivity, type AdminOverviewActivityItem } from "./activity";

function item(id: string, occurredAt: string): AdminOverviewActivityItem {
  return {
    id,
    kind: "signup",
    title: `Event ${id}`,
    detail: "Test activity",
    occurredAt,
    href: null,
    amountUsd: null,
    tone: "neutral",
  };
}

describe("buildOverviewActivity", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");

  it("sorts newest first and removes events outside the daily window", () => {
    const result = buildOverviewActivity(
      [
        item("old", "2026-10-10T12:00:00.000Z"),
        item("earlier", "2026-10-23T09:00:00.000Z"),
        item("latest", "2026-10-24T11:00:00.000Z"),
      ],
      { now, windowDays: 7 },
    );

    expect(result.items.map((entry) => entry.id)).toEqual(["latest", "earlier"]);
    expect(result.todayCount).toBe(1);
  });

  it("applies the requested feed limit after sorting", () => {
    const result = buildOverviewActivity(
      [
        item("one", "2026-10-24T09:00:00.000Z"),
        item("three", "2026-10-24T11:00:00.000Z"),
        item("two", "2026-10-24T10:00:00.000Z"),
      ],
      { now, limit: 2 },
    );

    expect(result.items.map((entry) => entry.id)).toEqual(["three", "two"]);
  });
});
