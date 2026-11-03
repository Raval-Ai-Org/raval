import { describe, expect, it } from "vitest";
import { pickVideoKind, VIDEO_KINDS } from "./kinds";
import { clipRoles, lengthNote, structureText } from "./structure";
import { hooksFor, pickVideoHook, VIDEO_HOOKS } from "./hooks";
import { textCues, cueFades } from "./overlay";
import { storyboardIssues, unknownClaims, type VideoStoryboard } from "./storyboard";
import { clipPlan } from "./lengths";

const board = (clips: Partial<VideoStoryboard["clips"][number]>[]): VideoStoryboard => ({
  logline: "Cold brew meets a summer afternoon",
  bible: {
    cast: [],
    product: "A matte green can of oat-milk cold brew",
    setting: "A sunlit concrete counter",
    lighting: "Warm late sun from the left",
    palette: "Green, cream, warm grey",
    camera: "50mm, shallow depth",
  },
  clips: clips.map((clip) => ({
    opensOn: "The can on the counter, condensation beading",
    shots: [
      { start: 0, end: 3, camera: "Macro", action: "Condensation runs down the can", cast: [] },
      { start: 3, end: 8, camera: "Push in", action: "The can turns to face camera", cast: [] },
    ],
    endsOn: "The can centred and still on the counter",
    sound: "Soft fizz and a warm beat",
    onScreen: "",
    voiceover: "",
    ...clip,
  })),
});

describe("new video kinds", () => {
  it.each([
    ["A demo of our blender's features", {}, "product-demo"],
    ["Show how it works in action", {}, "product-demo"],
    ["Aesthetic b-roll of our bakery", {}, "broll-hook"],
    ["3 reasons to switch to oat milk", {}, "broll-hook"],
    ["POV: your first sip of the morning", {}, "broll-hook"],
  ] as const)("Auto picks %s", (brief, source, kind) => {
    expect(pickVideoKind(brief, source)).toBe(kind);
  });

  it("only the B-roll reel holds one hook line", () => {
    expect(VIDEO_KINDS.filter((k) => k.words === "hook").map((k) => k.id)).toEqual(["broll-hook"]);
  });
});

describe("structure by length", () => {
  it("gives one role per clip, and a longer video is a different video", () => {
    for (const kind of VIDEO_KINDS.filter((k) => k.join !== "code"))
      for (let n = 1; n <= 4; n++) expect(clipRoles(kind.id, n)).toHaveLength(n);
    expect(clipRoles("product-motion", 1)[0]).not.toBe(clipRoles("product-motion", 2)[0]);
    expect(clipRoles("product-demo", 3)[2]).toMatch(/at rest/);
    expect(lengthNote(8)).toMatch(/loop/);
    expect(lengthNote(24)).toMatch(/B-roll/);
    expect(structureText("broll-hook", [8, 8])).toMatch(/^Clip 1 \(8s\)/);
  });
});

describe("video openings", () => {
  it("never puts hands in a no-people video", () => {
    expect(hooksFor("product-motion", "none").some((h) => h.hands)).toBe(false);
    expect(hooksFor("product-demo", "hands").some((h) => h.id === "pov")).toBe(true);
  });

  it("every kind has an opening, and the last two are skipped", () => {
    for (const kind of VIDEO_KINDS.filter((k) => k.join !== "code"))
      expect(hooksFor(kind.id, kind.people).length).toBeGreaterThan(0);
    const fitting = hooksFor("product-motion", "none").map((h) => h.id);
    const recent = fitting.slice(0, 2);
    for (const seed of ["a", "b", "c", "d", "e"])
      expect(recent).not.toContain(pickVideoHook("product-motion", "none", recent, seed)?.id);
  });

  it("keeps the same opening for the same job", () => {
    const a = pickVideoHook("broll-hook", "optional", [], "job-1");
    expect(pickVideoHook("broll-hook", "optional", [], "job-1")).toEqual(a);
    expect(new Set(VIDEO_HOOKS.map((h) => h.id)).size).toBe(VIDEO_HOOKS.length);
  });
});

describe("words drawn by code", () => {
  const plan = clipPlan(16, "standard");

  it("holds a B-roll reel's hook line over the whole video", () => {
    const cues = textCues(
      board([{ onScreen: "Summer tastes like this" }, {}]),
      plan,
      "broll-hook",
      {
        duration: 16,
      },
    );
    expect(cues).toEqual([{ text: "Summer tastes like this", start: 0, end: 15.75, role: "hook" }]);
    expect(cueFades(cues[0]).outAt).toBeLessThan(cues[0].end);
  });

  it("shows other kinds' phrases in their own clip, and nothing on a post", () => {
    const sb = board([{ onScreen: "Cold, smooth" }, { onScreen: "Made with oats" }]);
    const cues = textCues(sb, plan, "product-showcase", { duration: 16 });
    expect(cues.map((c) => [c.start, c.end])).toEqual([
      [0.2, 7.6],
      [8.4, 15.6],
    ]);
    expect(textCues(sb, plan, "product-showcase", { duration: 16, fromPicture: true })).toEqual([]);
    expect(textCues(sb, plan, "offer-teaser", { duration: 16 })).toEqual([]);
  });
});

describe("no invented claims or lettering", () => {
  const ctx = {
    kind: "broll-hook" as const,
    plan: clipPlan(16, "standard"),
    knownFacts: "Oat-milk cold brew, sold in cans. Organic oats.",
  };

  it("refuses claims the brand never made", () => {
    expect(unknownClaims("Clinically proven, #1 in town", ctx.knownFacts)).toEqual([
      "clinically",
      "proven",
      "#1",
    ]);
    expect(unknownClaims("Organic oats in every can", ctx.knownFacts)).toEqual([]);
    const issues = storyboardIssues(
      board([{ onScreen: "The award-winning cold brew" }, {}]),
      ctx,
    ).join(" ");
    expect(issues).toMatch(/award-winning/);
  });

  it("needs the hook line on clip 1 only", () => {
    expect(storyboardIssues(board([{}, {}]), ctx).join(" ")).toMatch(/hook line/);
    expect(
      storyboardIssues(
        board([{ onScreen: "Your summer, in a can" }, { onScreen: "Again" }]),
        ctx,
      ).join(" "),
    ).toMatch(/clip 1 only/);
    const second = {
      shots: [
        { start: 0, end: 4, camera: "Macro", action: "Oats spill across the counter", cast: [] },
        { start: 4, end: 8, camera: "Slow orbit", action: "The can rests in the sun", cast: [] },
      ],
    };
    expect(storyboardIssues(board([{ onScreen: "Your summer, in a can" }, second]), ctx)).toEqual(
      [],
    );
  });

  it("keeps readable words out of the footage", () => {
    const sb = board([
      {
        onScreen: "Your summer, in a can",
        shots: [
          {
            start: 0,
            end: 8,
            camera: "Wide",
            action: 'A chalkboard sign reads "cold brew here"',
            cast: [],
          },
        ],
      },
      {},
    ]);
    expect(storyboardIssues(sb, ctx).join(" ")).toMatch(/words into the footage/);
  });

  it("refuses a named competitor", () => {
    const sb = board([{ onScreen: "Better than Brewco" }, {}]);
    expect(storyboardIssues(sb, { ...ctx, competitors: ["Brewco"] }).join(" ")).toMatch(
      /Never name Brewco/,
    );
  });
});
