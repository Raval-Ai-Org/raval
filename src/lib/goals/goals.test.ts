import { describe, expect, it } from "vitest";
import { decideGoals, goalLine, isStretch, toAutopilotGoal } from "./decide";
import { goalProgress } from "./progress";

const NOW = new Date("2026-11-01T00:00:00Z");

describe("decideGoals", () => {
  it("cleans typed numbers and clamps cadence", () => {
    const d = decideGoals(
      {
        focus: "followers",
        targets: [
          { metric: "followers", platform: "instagram", target: "3,000", baseline: "1200" },
        ],
        timeframeWeeks: 13,
        postsPerWeek: 40,
        channels: ["instagram", "instagram", "tiktok"],
      },
      NOW,
    );
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.goals.targets[0]).toEqual({
      metric: "followers",
      platform: "instagram",
      target: 3000,
      baseline: 1200,
    });
    expect(d.goals.timeframeWeeks).toBe(12);
    expect(d.goals.postsPerWeek).toBe(14);
    expect(d.goals.channels).toEqual(["instagram", "tiktok"]);
    expect(d.goals.startedAt).toBe(NOW.toISOString());
  });

  it("refuses a target at or below the starting point", () => {
    const d = decideGoals(
      {
        focus: "followers",
        targets: [{ metric: "followers", target: 500, baseline: 800 }],
        timeframeWeeks: 12,
        postsPerWeek: 3,
      },
      NOW,
    );
    expect(d.ok).toBe(false);
  });

  it("needs a focus", () => {
    expect(decideGoals({ timeframeWeeks: 12, postsPerWeek: 3 }, NOW).ok).toBe(false);
  });

  it("labels a stretch but still saves it", () => {
    const d = decideGoals(
      {
        focus: "followers",
        targets: [{ metric: "followers", target: 1_000_000, baseline: 100 }],
        timeframeWeeks: 4,
        postsPerWeek: 3,
      },
      NOW,
    );
    expect(d.ok && d.warnings[0]?.code).toBe("stretch");
  });

  it("does not call a reasonable target a stretch", () => {
    expect(isStretch({ metric: "followers", target: 1500, baseline: 1000 }, 12)).toBe(false);
  });

  it("keeps the start date when only the numbers change", () => {
    const first = decideGoals({ focus: "reach", timeframeWeeks: 12, postsPerWeek: 3 }, NOW);
    if (!first.ok) throw new Error("expected ok");
    const later = decideGoals(
      { focus: "reach", timeframeWeeks: 12, postsPerWeek: 5 },
      new Date("2026-11-20T00:00:00Z"),
      first.goals,
    );
    expect(later.ok && later.goals.startedAt).toBe(NOW.toISOString());
  });
});

describe("goal words", () => {
  it("maps focus to an Autopilot goal", () => {
    expect(toAutopilotGoal("followers")).toBe("awareness");
    expect(toAutopilotGoal("sales")).toBe("sales");
  });

  it("writes one plain line", () => {
    const d = decideGoals(
      {
        focus: "followers",
        targets: [{ metric: "followers", platform: "instagram", target: 3000, baseline: 1200 }],
        timeframeWeeks: 12,
        postsPerWeek: 3,
      },
      NOW,
    );
    if (!d.ok) throw new Error("expected ok");
    expect(goalLine(d.goals)).toBe(
      "Grow my following: 1,200 → 3,000 Instagram followers by 24 Jan",
    );
  });
});

describe("goalProgress", () => {
  const d = decideGoals(
    {
      focus: "followers",
      targets: [
        { metric: "followers", platform: "instagram", target: 3000, baseline: 1200 },
        { metric: "reach", target: 50_000 },
      ],
      timeframeWeeks: 12,
      postsPerWeek: 3,
    },
    NOW,
  );
  if (!d.ok) throw new Error("expected ok");

  it("never estimates what it can't read", () => {
    const p = goalProgress(
      d.goals,
      { postsPublished: 2, views: null, connected: [] },
      new Date("2026-11-15T00:00:00Z"),
    );
    const followers = p.rows.find((r) => r.id.startsWith("followers"))!;
    expect(followers.state).toBe("not_measured");
    expect(p.rows.find((r) => r.id.startsWith("reach"))!.state).toBe("not_measured");
    expect(p.weeksElapsed).toBe(2);
  });

  it("counts posts and views it really has", () => {
    const p = goalProgress(
      d.goals,
      { postsPublished: 7, views: 12_000, connected: ["instagram"] },
      new Date("2026-11-15T00:00:00Z"),
    );
    const posts = p.rows.find((r) => r.id === "posts")!;
    expect(posts.state === "measured" && posts.value).toBe(7);
    expect(posts.state === "measured" && posts.detail).toBe("On pace with your plan");
    const reach = p.rows.find((r) => r.id.startsWith("reach"))!;
    expect(reach.state === "measured" && reach.ratio).toBeCloseTo(0.24);
  });
});
