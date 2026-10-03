// Stories: the pure rules. Frames, placements, per-frame delivery, timing and
// numbers, all without a network or a database.
import { describe, expect, it } from "vitest";
import {
  STORY_THEMES,
  framePlanText,
  framesFromMeta,
  getStoryTheme,
  normalizeFrames,
  pickStoryTheme,
  storyIssue,
  storyText,
} from "./frames";
import {
  STORY_FEATURES,
  cleanMentions,
  isStoryItem,
  placementForItem,
  supportsPlacement,
  toProviderPlacement,
} from "./placement";
import {
  framePostIds,
  framesToRetry,
  initialFrames,
  markRetried,
  mergeFrames,
  readFrames,
  rowOutcome,
} from "./results";
import {
  DEFAULT_STORY_SETTINGS,
  StorySettingsSchema,
  bestHours,
  isStorySlot,
  readStorySettings,
  storyTimes,
  weekStorySlots,
} from "./schedule";
import { combineFrames, holdRate, storyMetricsFrom, summarizeStories } from "./metrics";
import { detectStudioType } from "@/lib/studio/detect";
import { studioChargeFor } from "@/lib/studio/billing";
import { STUDIO_FORMATS, studioTypeFromContent } from "@/lib/studio/formats";
import { studioOutputQualityIssue } from "@/lib/studio/quality";

const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

describe("frames", () => {
  const tip = getStoryTheme("tip")!;

  it("gives every theme a role per position, one frame included", () => {
    for (const theme of STORY_THEMES) {
      expect(theme.plan(1)).toHaveLength(1);
      expect(theme.plan(4)).toHaveLength(4);
      expect(theme.plan(99).length).toBeLessThanOrEqual(7);
    }
    expect(tip.plan(3)).toEqual(["hook", "value", "cta"]);
    expect(getStoryTheme("question")!.plan(2)).toEqual(["hook", "question"]);
    expect(getStoryTheme("offer")!.plan(1)).toEqual(["offer"]);
  });

  it("cleans what a model returns: roles by position, no emoji, real highlights only", () => {
    const frames = normalizeFrames(
      [
        { role: "cta", heading: "Sour cold brew? 🧊 One fix.", emphasis: "One fix", body: "" },
        {
          heading: "Steep it longer",
          emphasis: "not in heading",
          body: "Three more hours.\nReally.",
        },
        { heading: "Try it tonight", kicker: "Go", body: "Reply and tell us." },
      ],
      { theme: tip, count: 3 },
    );
    expect(frames.map((f) => f.role)).toEqual(["hook", "value", "cta"]);
    expect(frames[0].heading).toBe("Sour cold brew? One fix.");
    expect(frames[0].emphasis).toBe("One fix");
    expect(frames[1].emphasis).toBeUndefined();
    expect(frames[1].body).toBe("Three more hours. Really.");
    // The closing frame carries no label.
    expect(frames[2].kicker).toBeUndefined();
  });

  it("keeps answer choices only on a question frame, at most four, deduplicated", () => {
    const q = getStoryTheme("question")!;
    const [hook, question] = normalizeFrames(
      [
        { heading: "Quick one", options: ["A", "B"] },
        {
          heading: "How long do you steep?",
          options: ["12 hours", "12 hours", "18", "24", "36", "48"],
        },
      ],
      { theme: q, count: 2 },
    );
    expect(hook.options).toBeUndefined();
    expect(question.options).toEqual(["12 hours", "18", "24", "36"]);
  });

  it("names what is wrong with a Story before it is saved", () => {
    const ok = normalizeFrames(
      [{ heading: "One fix for sour cold brew" }, { heading: "Steep three hours longer" }],
      { theme: tip, count: 2 },
    );
    expect(storyIssue(ok, 2)).toBeNull();
    expect(storyIssue([], 2)).toMatch(/no frames/);
    expect(storyIssue(ok, 3)).toMatch(/wrong number/);
    expect(storyIssue([{ ...ok[0], heading: "" }])).toMatch(/no headline/);
    expect(storyIssue([ok[0], { ...ok[1], heading: ok[0].heading }])).toMatch(/same thing/);
    expect(storyIssue([{ ...ok[0], body: "x".repeat(190) }])).toMatch(/five seconds/);
    expect(
      storyIssue([{ role: "question", heading: "Which one?", body: "", options: ["Only one"] }]),
    ).toMatch(/two answers/);
  });

  it("rotates themes through the chosen mix and never repeats the last one", () => {
    const mix = ["tip", "behind", "question"];
    const first = pickStoryTheme({ seed: "a", mix, recent: [] });
    const next = pickStoryTheme({ seed: "a", mix, recent: [first.id] });
    expect(mix).toContain(first.id);
    expect(next.id).not.toBe(first.id);
    // Deterministic per seed, so a retried request makes the same Story.
    expect(pickStoryTheme({ seed: "a", mix, recent: [first.id] }).id).toBe(next.id);
    // An explicit ask always wins; "repurpose" is never picked by rotation.
    expect(pickStoryTheme({ seed: "a", mix, preferred: "offer" }).id).toBe("offer");
    for (let i = 0; i < 30; i++) expect(pickStoryTheme({ seed: `s${i}` }).id).not.toBe("repurpose");
  });

  it("tells the model the plan, and reads stored frames defensively", () => {
    expect(framePlanText(tip, 3).split("\n")).toHaveLength(3);
    expect(storyText([{ role: "hook", heading: "A", body: "b" }])).toBe("A b");
    expect(framesFromMeta(null)).toEqual([]);
    expect(framesFromMeta({ story: { theme: "tip", frames: "nope" } })).toEqual([]);
    expect(
      framesFromMeta({ story: { theme: "tip", frames: [{ heading: "Hello there" }] } })[0].role,
    ).toBe("hook");
  });
});

describe("placement", () => {
  it("knows which networks have Stories and Reels", () => {
    expect(supportsPlacement("instagram", "stories")).toBe(true);
    expect(supportsPlacement("facebook", "stories")).toBe(true);
    expect(supportsPlacement("threads", "stories")).toBe(false);
    expect(supportsPlacement("threads", "reels")).toBe(true);
    expect(supportsPlacement("linkedin", "reels")).toBe(false);
    expect(toProviderPlacement("feed")).toBe("timeline");
  });

  it("sends a Story to Stories, a video to Reels and the rest to the feed", () => {
    expect(placementForItem({ kind: "story", meta: { platform: "instagram" } })).toBe("stories");
    expect(placementForItem({ kind: "video", meta: { platform: "facebook" } })).toBe("reels");
    expect(placementForItem({ kind: "image", meta: { platform: "instagram" } })).toBe("feed");
    expect(
      placementForItem({ kind: "video", meta: { platform: "instagram", placement: "feed" } }),
    ).toBe("feed");
    // One-placement networks send none at all.
    expect(placementForItem({ kind: "video", meta: { platform: "tiktok" } })).toBeNull();
    // A Story on a network without Stories is not silently posted to the feed.
    expect(placementForItem({ kind: "story", meta: { platform: "linkedin" } })).toBeNull();
    expect(isStoryItem({ kind: "post", meta: { placement: "stories" } })).toBe(true);
  });

  it("is honest about what an API-posted Story can carry", () => {
    const unsupported = STORY_FEATURES.filter((f) => !f.supported).map((f) => f.id);
    expect(unsupported).toEqual(expect.arrayContaining(["link", "poll", "music"]));
    for (const f of STORY_FEATURES) expect(f.how.length).toBeGreaterThan(10);
  });

  it("cleans Instagram usernames", () => {
    expect(cleanMentions("@Roaster.Co, @roaster.co  bad!name @ok_1")).toEqual([
      "roaster.co",
      "ok_1",
    ]);
    expect(cleanMentions(["a", "b", "c", "d", "e", "f"])).toHaveLength(5);
    expect(cleanMentions(42)).toEqual([]);
  });
});

describe("per-frame delivery", () => {
  it("is published only when every frame went out", () => {
    let frames = initialFrames(3, "p1", "publishing");
    expect(rowOutcome(frames).status).toBe("publishing");
    frames = mergeFrames(
      frames,
      "p1",
      [
        { frame: 0, status: "published", platformPostId: "ig0", permalink: "https://ig/0" },
        { frame: 2, status: "published", platformPostId: "ig2" },
      ],
      { status: "publishing" },
    );
    expect(rowOutcome(frames)).toMatchObject({ status: "publishing", sent: 2, total: 3 });
    frames = mergeFrames(frames, "p1", [{ frame: 1, status: "published" }], null);
    expect(rowOutcome(frames)).toMatchObject({
      status: "published",
      platformPostId: "ig0",
      permalink: "https://ig/0",
    });
  });

  it("reports a partly posted Story as failed, saying how many went out", () => {
    const frames = mergeFrames(
      initialFrames(3, "p1", "publishing"),
      "p1",
      [
        { frame: 0, status: "published" },
        { frame: 1, status: "failed", error: "Video too long" },
        { frame: 2, status: "published" },
      ],
      null,
    );
    const outcome = rowOutcome(frames);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/2 of 3 frames went out; 1 failed\. Video too long/);
    expect(framesToRetry(frames)).toEqual([1]);
  });

  it("never lets a frame that went out go back", () => {
    let frames = mergeFrames(
      initialFrames(2, "p1", "publishing"),
      "p1",
      [{ frame: 0, status: "published", platformPostId: "a" }],
      null,
    );
    frames = mergeFrames(frames, "p1", [{ frame: 0, status: "failed", error: "late" }], {
      status: "publishing",
    });
    expect(frames[0]).toMatchObject({ status: "published", platformPostId: "a" });
  });

  it("does not guess which multi-frame result belongs to a frame", () => {
    const frames = mergeFrames(
      initialFrames(2, "p1", "publishing"),
      "p1",
      [{ status: "published" }, { status: "failed", error: "x" }],
      null,
    );
    expect(frames.map((f) => f.status)).toEqual(["publishing", "publishing"]);
    expect(framesToRetry(frames)).toEqual([]);
  });

  it("retries only the failed frames, in their own provider post", () => {
    let frames = mergeFrames(
      initialFrames(3, "p1", "publishing").map((frame) => ({
        ...frame,
        source: `workspace/ws/assets/${frame.i}.jpg`,
      })),
      "p1",
      [
        { frame: 0, status: "published" },
        { frame: 1, status: "failed", error: "x" },
        { frame: 2, status: "failed", error: "x" },
      ],
      null,
    );
    frames = markRetried(frames, framesToRetry(frames), "p2");
    expect(frames.map((f) => f.postId)).toEqual(["p1", "p2", "p2"]);
    expect(frames[1].source).toBe("workspace/ws/assets/1.jpg");
    expect(framePostIds(frames, "p1")).toEqual(["p1", "p2"]);
    // The retry post has two media items: its index 1 is the Story's frame 2.
    frames = mergeFrames(
      frames,
      "p2",
      [
        { frame: 1, status: "published", platformPostId: "late" },
        { frame: 0, status: "published" },
      ],
      null,
    );
    expect(frames[2].platformPostId).toBe("late");
    expect(rowOutcome(frames).status).toBe("published");
    // A snapshot of the first post no longer touches the retried frames.
    const again = mergeFrames(frames, "p1", [{ frame: 1, status: "failed" }], null);
    expect(rowOutcome(again).status).toBe("published");
  });

  it("stays pending while scheduled and reads stored frames defensively", () => {
    expect(rowOutcome(initialFrames(2, "p", "pending")).status).toBe("pending");
    expect(readFrames(null)).toBeNull();
    expect(readFrames([{ i: 0 }])).toBeNull();
    expect(
      readFrames([
        { i: 1, status: "failed", postId: "p" },
        { i: 0, status: "published", postId: "p" },
      ])![0].i,
    ).toBe(0);
  });
});

describe("timing", () => {
  it("validates settings and reads stored ones safely", () => {
    expect(StorySettingsSchema.safeParse({ ...DEFAULT_STORY_SETTINGS, perDay: 9 }).success).toBe(
      false,
    );
    expect(
      StorySettingsSchema.safeParse({
        ...DEFAULT_STORY_SETTINGS,
        windowStart: "10:00",
        windowEnd: "10:30",
      }).success,
    ).toBe(false);
    expect(readStorySettings({}).enabled).toBe(false);
    expect(readStorySettings("garbage").enabled).toBe(false);
    expect(readStorySettings({ enabled: true, perDay: 2 })).toMatchObject({
      enabled: true,
      perDay: 2,
    });
  });

  it("keeps times inside the window and apart from each other", () => {
    const { times, source } = storyTimes({ windowStart: "09:00", windowEnd: "20:00", perDay: 3 });
    expect(times).toHaveLength(3);
    expect(source).toBe("common");
    for (const t of times) expect(t >= "09:00" && t <= "20:00").toBe(true);
    const mins = times.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
    for (let i = 1; i < mins.length; i++) expect(mins[i] - mins[i - 1]).toBeGreaterThanOrEqual(90);
    // A narrow window still yields the asked number of distinct times.
    const narrow = storyTimes({ windowStart: "13:00", windowEnd: "14:00", perDay: 2 });
    expect(new Set(narrow.times).size).toBe(2);
  });

  it("only learns an hour from two or more measured Stories, and uses it first", () => {
    const learned = bestHours([
      { hour: 19, reach: 900 },
      { hour: 19, reach: 700 },
      { hour: 7, reach: 5000 }, // one lucky Story is not a pattern
      { hour: 11, reach: 300 },
      { hour: 11, reach: 200 },
    ]);
    expect(learned.map((h) => h.hour)).toEqual([19, 11]);
    const { times, source } = storyTimes({
      windowStart: "09:00",
      windowEnd: "21:00",
      perDay: 1,
      learned,
    });
    expect(source).toBe("learned");
    expect(times).toEqual(["19:15"]);
  });

  it("plans a week of slots with rotating themes, on the chosen days only", () => {
    const settings = {
      ...DEFAULT_STORY_SETTINGS,
      enabled: true,
      perDay: 2,
      days: [1, 3, 5],
      themes: ["tip", "behind", "question"] as ("tip" | "behind" | "question")[],
    };
    const slots = weekStorySlots({
      settings,
      weekStart: "2026-10-05", // a Monday
      endsOn: "2026-12-31",
      addDays,
      weekday,
    });
    expect(slots).toHaveLength(6);
    expect(new Set(slots.map((s) => s.date))).toEqual(
      new Set(["2026-10-05", "2026-10-07", "2026-10-09"]),
    );
    for (let i = 1; i < slots.length; i++) expect(slots[i].theme).not.toBe(slots[i - 1].theme);
    expect(new Set(slots.map((s) => s.index)).size).toBe(6);
    expect(slots.every((s) => isStorySlot(s.index))).toBe(true);
    expect(isStorySlot(3)).toBe(false);
    // Off means no slots; a program that ends mid-week stops there.
    expect(
      weekStorySlots({
        settings: { ...settings, enabled: false },
        weekStart: "2026-10-05",
        endsOn: "2026-12-31",
        addDays,
        weekday,
      }),
    ).toEqual([]);
    expect(
      weekStorySlots({ settings, weekStart: "2026-10-05", endsOn: "2026-10-06", addDays, weekday }),
    ).toHaveLength(2);
  });
});

describe("numbers", () => {
  it("reads only what a network reported", () => {
    expect(storyMetricsFrom({ reach: 120, views: 150, replies: 4, navigation: 30 })).toMatchObject({
      reach: 120,
      views: 150,
      replies: 4,
      taps: 30,
    });
    expect(storyMetricsFrom({ media_views: 80 }).views).toBe(80);
    expect(storyMetricsFrom(null).reach).toBe(0);
  });

  it("takes reach from the widest frame and adds the rest up", () => {
    const frames = [
      storyMetricsFrom({ reach: 200, views: 220, replies: 1 }),
      storyMetricsFrom({ reach: 150, views: 160, replies: 2 }),
    ];
    expect(combineFrames(frames)).toMatchObject({ reach: 200, views: 380, replies: 3 });
    expect(holdRate(frames)).toBe(0.75);
    expect(holdRate([frames[0]])).toBeNull();
    expect(holdRate([storyMetricsFrom({}), frames[1]])).toBeNull();
  });

  it("summarises without inventing a best time from one Story", () => {
    const base = { platform: "instagram", frames: 2, hold: null };
    const summary = summarizeStories([
      {
        ...base,
        id: "a",
        title: "A",
        publishedAt: "x",
        hour: 19,
        metrics: storyMetricsFrom({ reach: 400, replies: 8 }),
      },
      {
        ...base,
        id: "b",
        title: "B",
        publishedAt: "x",
        hour: 19,
        metrics: storyMetricsFrom({ reach: 200 }),
      },
      {
        ...base,
        id: "c",
        title: "C",
        publishedAt: "x",
        hour: 8,
        metrics: storyMetricsFrom({ reach: 900 }),
      },
      { ...base, id: "d", title: "D", publishedAt: "x", hour: 8, metrics: null },
    ]);
    expect(summary).toMatchObject({
      count: 4,
      measured: 3,
      reach: 1500,
      avgReach: 500,
      bestHour: 19,
    });
    expect(summary.best?.id).toBe("c");
    expect(summary.replyRate).toBeCloseTo(8 / 1500);
    expect(summarizeStories([]).bestHour).toBeNull();
  });
});

describe("the Story format in Studio", () => {
  it("is a first-class type with its own kind, platforms and price", () => {
    expect(STUDIO_FORMATS.story).toMatchObject({
      kind: "story",
      platforms: ["instagram", "facebook"],
      ratios: ["9:16"],
    });
    expect(studioTypeFromContent("story", null)).toBe("story");
    expect(studioChargeFor({ type: "story" })).toBe("story");
    expect(studioChargeFor({ type: "story", storyMode: "video" })).toBe("studio_video");
  });

  it("is only detected when someone asks for the format, not for 'a customer story'", () => {
    expect(detectStudioType("An Instagram story about our new menu")).toBe("story");
    expect(detectStudioType("daily stories for the shop")).toBe("story");
    expect(detectStudioType("A post telling our founder's story")).not.toBe("story");
    expect(detectStudioType("customer stories roundup article")).not.toBe("story");
  });

  it("checks a Story's frames, or a video Story's idea", () => {
    const frames = normalizeFrames([{ heading: "One fix for sour brew" }], {
      theme: getStoryTheme("tip"),
      count: 1,
    });
    const controls = { platforms: ["instagram" as const], frameCount: 1 };
    expect(
      studioOutputQualityIssue(
        "story",
        { story: { mode: "frames", theme: "tip", frames } },
        controls,
        1,
      ),
    ).toBeNull();
    expect(
      studioOutputQualityIssue(
        "story",
        { story: { mode: "frames", theme: "tip", frames: [] } },
        controls,
        1,
      ),
    ).toMatch(/no frames/);
    expect(
      studioOutputQualityIssue(
        "story",
        { concept: "short", story: { mode: "video", theme: "tip", frames: [] } },
        controls,
        1,
      ),
    ).toMatch(/too vague/);
  });
});
