import { describe, expect, it } from "vitest";
import {
  isLive,
  radarBlock,
  radarForBrief,
  radarFromRow,
  reaches,
  trendsForWorkspace,
  type RadarTrend,
} from "./radar";

const NOW = new Date("2026-11-19T12:00:00Z");
const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function trend(patch: Partial<RadarTrend> = {}): RadarTrend {
  return {
    id: "t1",
    title: "GTA 6 launch",
    brief: "The game is out today.",
    whatToMake: "A loading-screen tip in the brand's world.",
    doNots: "No game logos.",
    scope: "all",
    industries: [],
    workspaceIds: [],
    languages: [],
    platforms: [],
    tags: ["gta vi"],
    links: [],
    media: [],
    allowMood: false,
    startsAt: "2026-11-18T00:00:00Z",
    endsAt: null,
    status: "live",
    priority: 3,
    ...patch,
  };
}

const who = { workspaceId: WS, industryId: "restaurant" as const, today: NOW };

describe("Trend Radar matching", () => {
  it("is live only when published and inside its window", () => {
    expect(isLive(trend(), NOW)).toBe(true);
    expect(isLive(trend({ status: "draft" }), NOW)).toBe(false);
    expect(isLive(trend({ startsAt: "2026-11-20T00:00:00Z" }), NOW)).toBe(false);
    expect(isLive(trend({ endsAt: "2026-11-19T00:00:00Z" }), NOW)).toBe(false);
  });

  it("all reaches everyone; specific and micro need the industry or the brand", () => {
    expect(reaches(trend(), who)).toBe(true);
    expect(reaches(trend({ scope: "specific", industries: ["saas"] }), who)).toBe(false);
    expect(reaches(trend({ scope: "specific", industries: ["restaurant"] }), who)).toBe(true);
    expect(reaches(trend({ scope: "specific", workspaceIds: [WS] }), who)).toBe(true);
    expect(reaches(trend({ scope: "specific", workspaceIds: [OTHER] }), who)).toBe(false);
    expect(reaches(trend({ scope: "micro", industries: ["restaurant"] }), who)).toBe(true);
    expect(reaches(trend({ scope: "micro", industries: ["fashion"] }), who)).toBe(false);
  });

  it("a language filter applies on top of the scope", () => {
    expect(reaches(trend({ languages: ["Urdu"] }), { ...who, language: "English" })).toBe(false);
    expect(reaches(trend({ languages: ["urdu"] }), { ...who, language: "Urdu" })).toBe(true);
  });

  it("orders by priority, then fit", () => {
    const list = trendsForWorkspace(
      [
        trend({ id: "low", priority: 1 }),
        trend({ id: "high", priority: 5 }),
        trend({ id: "aimed", priority: 1, scope: "specific", workspaceIds: [WS] }),
      ],
      who,
    );
    expect(list.map((t) => t.id)).toEqual(["high", "aimed", "low"]);
  });

  it("finds the trend a brief names, by title or tag, and the picked one first", () => {
    const trends = [trend(), trend({ id: "t2", title: "Ramadan", tags: [] })];
    expect(radarForBrief(trends, "A post about GTA 6 for our cafe")?.id).toBe("t1");
    expect(radarForBrief(trends, "gta vi tie-in")?.id).toBe("t1");
    expect(radarForBrief(trends, "Our new burger")).toBeNull();
    expect(radarForBrief(trends, "anything", "t2")?.id).toBe("t2");
  });

  it("the block keeps the brand as the hero and the owner's art out", () => {
    const block = radarBlock(trend());
    expect(block).toContain("GTA 6 launch");
    expect(block).toMatch(/never use the trend owner's logos/i);
  });

  it("reads a database row and refuses one without an id or title", () => {
    const row = {
      id: "r1",
      title: "World Cup",
      brief: "b",
      what_to_make: "w",
      do_nots: "d",
      scope: "micro",
      industries: ["restaurant"],
      workspace_ids: [],
      languages: [],
      platforms: [],
      tags: [],
      links: [],
      media: [{ path: "platform/trends/x/y.jpg", kind: "image" }],
      allow_mood: true,
      starts_at: "2026-11-18T00:00:00Z",
      ends_at: null,
      status: "live",
      priority: 4,
    };
    const parsed = radarFromRow(row);
    expect(parsed?.scope).toBe("micro");
    expect(parsed?.whatToMake).toBe("w");
    expect(parsed?.allowMood).toBe(true);
    expect(radarFromRow({ id: "x" })).toBeNull();
  });
});
