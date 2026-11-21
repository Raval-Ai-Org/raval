import { describe, expect, it } from "vitest";
import type { BrainCard, BrainOverview } from "@/lib/brain/brain";
import { EMPTY_PULSE, type WorkspacePulse } from "@/lib/pulse/pulse";
import {
  askPrompts,
  brainTiles,
  homeNeeds,
  latestUpdates,
  MAX_ASKS,
  rightNow,
  timeAgo,
} from "./explore";

const card = (p: Partial<BrainCard> = {}): BrainCard => ({
  ready: true,
  health: 80,
  headline: "",
  updatedAt: null,
  enabled: true,
  facts: [],
  ...p,
});

const overview = (p: Partial<BrainOverview> = {}): BrainOverview => ({
  brains: {
    brand: card({ headline: "Warm, plain-spoken", facts: ["3 products"] }),
    audience: card({ facts: ["4 groups", "2 new", "x", "y"] }),
    competitors: card({ enabled: false }),
    market: card({ health: 140 }),
  },
  strategy: { status: null, stale: false, updatedAt: null, pillars: [], headline: "" },
  updates: [],
  needs: [],
  generatedAt: "2026-11-13T00:00:00Z",
  ...p,
});

describe("brain tiles", () => {
  it("shows every brain with its purpose before the overview arrives", () => {
    const tiles = brainTiles(null);
    expect(tiles.map((t) => t.id)).toEqual([
      "brand",
      "audience",
      "competitors",
      "market",
      "strategy",
    ]);
    expect(tiles.every((t) => t.facts.length === 0 && t.health === null)).toBe(true);
  });

  it("uses real lines and numbers, drops switched-off brains, caps facts", () => {
    const tiles = brainTiles(overview());
    expect(tiles.find((t) => t.id === "competitors")).toBeUndefined();
    expect(tiles.find((t) => t.id === "brand")?.line).toBe("Warm, plain-spoken");
    expect(tiles.find((t) => t.id === "audience")?.facts).toHaveLength(3);
    expect(tiles.find((t) => t.id === "market")?.health).toBe(1);
  });

  it("says when a strategy draft waits, and lists a confirmed one's pillars", () => {
    const draft = brainTiles(
      overview({
        strategy: { status: "draft", stale: false, updatedAt: null, pillars: [], headline: "x" },
      }),
    ).find((t) => t.id === "strategy");
    expect(draft?.line).toMatch(/draft/i);
    expect(draft?.ready).toBe(false);
    const done = brainTiles(
      overview({
        strategy: {
          status: "confirmed",
          stale: false,
          updatedAt: null,
          pillars: [{ title: "Behind the roast", share: 40 }],
          headline: "Own the morning ritual",
        },
      }),
    ).find((t) => t.id === "strategy");
    expect(done?.line).toBe("Own the morning ritual");
    expect(done?.facts).toEqual(["Behind the roast"]);
  });
});

describe("right now", () => {
  it("is empty when the pulse is unknown or quiet", () => {
    expect(rightNow(null)).toEqual([]);
    expect(rightNow(EMPTY_PULSE)).toEqual([]);
  });

  it("lists waiting posts, running campaigns and the goal from rows", () => {
    const pulse: WorkspacePulse = {
      ...EMPTY_PULSE,
      waiting: 1,
      campaigns: [
        { id: "a", name: "Summer drop", phase: "Tease", keyDate: null, waiting: 1 },
        { id: "b", name: "B", phase: null, keyDate: null, waiting: 0 },
        { id: "c", name: "C", phase: null, keyDate: null, waiting: 0 },
      ],
      goal: { focus: "sales", label: "Sell more" },
    };
    const items = rightNow(pulse);
    expect(items.map((i) => i.id)).toEqual(["waiting", "campaign:a", "campaign:b", "goal"]);
    expect(items[0]?.label).toBe("1 post waits for you");
  });
});

describe("ask prompts", () => {
  it("falls back to everyday questions", () => {
    const asks = askPrompts(null);
    expect(asks).toHaveLength(MAX_ASKS);
    expect(new Set(asks).size).toBe(asks.length);
  });

  it("leads with the brand's own product, campaign and goal", () => {
    const asks = askPrompts({
      ...EMPTY_PULSE,
      products: ["Cold brew"],
      campaigns: [{ id: "a", name: "Summer drop", phase: null, keyDate: null, waiting: 0 }],
      goal: { focus: "sales", label: "Sell more" },
    });
    expect(asks.slice(0, 3)).toEqual([
      "Write 3 hooks for Cold brew",
      "What should I post next for Summer drop?",
      "Plan a week of posts for my goal: sell more",
    ]);
    expect(asks).toHaveLength(MAX_ASKS);
  });
});

describe("needs, updates and time", () => {
  it("passes Brain's needs through, capped", () => {
    const o = {
      ...overview(),
      needs: [1, 2, 3, 4, 5].map((n) => ({
        id: `n${n}`,
        brain: "market" as const,
        label: `Need ${n}`,
        cta: "Open",
      })),
    };
    expect(homeNeeds(o).map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(homeNeeds(null)).toEqual([]);
  });

  it("orders updates newest first with a short age", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const o = {
      ...overview(),
      updates: [
        { id: "a", brain: "market" as const, title: "Old", at: "2026-11-10T12:00:00Z" },
        { id: "b", brain: "competitors" as const, title: "New", at: "2026-11-13T09:00:00Z" },
      ],
    };
    expect(latestUpdates(o, 3, now)).toEqual([
      { id: "b", brain: "competitors", title: "New", when: "3h ago" },
      { id: "a", brain: "market", title: "Old", when: "3d ago" },
    ]);
    expect(timeAgo("nope", now)).toBe("");
    expect(timeAgo("2026-11-13T11:59:30Z", now)).toBe("now");
  });
});
