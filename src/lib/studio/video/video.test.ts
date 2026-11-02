import { describe, expect, it } from "vitest";
import { UGC_MODEL_KEYS } from "@/lib/ugc/models";
import { STUDIO_TEMPLATES } from "../templates";
import {
  kindForTemplate,
  peoplePolicy,
  pickVideoKind,
  recommendedModel,
  studioVideoModelFor,
  usableKind,
  VIDEO_KINDS,
  videoKind,
} from "./kinds";
import { settleVideoControls } from "./settle";
import { clipPlan, defaultLength, lengthChoices, snapLength, CLIP_SECONDS } from "./lengths";
import {
  clipPrompt,
  fitStoryboard,
  storyboardIssues,
  storyboardSummary,
  StoryboardSchema,
  type VideoStoryboard,
} from "./storyboard";
import {
  qaFrameTimes,
  redoPlan,
  technicalIssues,
  visualFailures,
  VIDEO_REDO_ROUNDS,
  VideoJudgeSchema,
} from "./checks";

describe("video kinds", () => {
  it("has unique ids and valid models", () => {
    expect(new Set(VIDEO_KINDS.map((k) => k.id)).size).toBe(VIDEO_KINDS.length);
    for (const kind of VIDEO_KINDS) {
      for (const model of kind.models) expect(UGC_MODEL_KEYS).toContain(model);
      expect(kind.defaultClips).toBeLessThanOrEqual(kind.maxClips);
      if (kind.join !== "code") expect(kind.rules.length).toBeGreaterThan(0);
    }
  });

  it("maps every AI video template to a kind", () => {
    const video = STUDIO_TEMPLATES.filter(
      (t) => t.types.includes("video") && t.controls?.videoMode !== "site",
    );
    expect(video.length).toBeGreaterThan(0);
    for (const template of video) expect(kindForTemplate(template.id)).not.toBeNull();
  });

  it.each([
    ["Our summer sale: 20% off everything", {}, "offer-teaser"],
    ["How to brew the perfect pour over", {}, "how-it-works"],
    ["Before and after a deep clean", {}, "before-after"],
    ["The vibe of our cafe on a rainy morning", {}, "mood-broll"],
    ["A customer's morning with our app", {}, "brand-story"],
    ["Show off the new bottle", { product: true }, "product-motion"],
    ["A woman holding the new bottle", { product: true }, "product-showcase"],
    ["Bring my candle to life", {}, "product-motion"],
    ["Handmade soap, made with love", {}, "product-motion"],
    ["Our serum and its results", {}, "product-motion"],
    ["Anything", { picture: true }, "living-picture"],
    ["Anything", { picture: true, product: true }, "product-motion"],
    ["Anything", { carousel: true }, "motion-post"],
  ] as const)("picks %s", (brief, source, kind) => {
    expect(pickVideoKind(brief, source)).toBe(kind);
  });

  it("a template wins over the brief", () => {
    expect(pickVideoKind("sale", {}, "video-process")).toBe("how-it-works");
  });

  it("a kind that needs a post falls back to a product film, never a cast story", () => {
    expect(usableKind("living-picture", {})).toBe("product-motion");
    expect(usableKind("living-picture", { product: true })).toBe("product-motion");
    expect(usableKind("living-picture", { picture: true })).toBe("living-picture");
  });

  it("adds people only when someone asked", () => {
    expect(peoplePolicy("product-motion", { brief: "a woman using it" })).toBe("none");
    expect(peoplePolicy("mood-broll", { brief: "our cafe at dawn" })).toBe("hands");
    expect(peoplePolicy("mood-broll", { brief: "friends laughing in our cafe" })).toBe("optional");
    expect(peoplePolicy("brand-story", { brief: "the story of our kettle" })).toBe("hands");
    expect(peoplePolicy("brand-story", { brief: "the story of our kettle", chosen: true })).toBe(
      "cast",
    );
    expect(peoplePolicy("brand-story", { chosen: true, reference: "none" })).toBe("hands");
    expect(peoplePolicy("offer-teaser", { reference: "people" })).toBe("optional");
    expect(peoplePolicy("living-picture")).toBe("source");
  });

  it("settles once: a picked-for-you kind keeps its people rule on the server", () => {
    const first = settleVideoControls({
      type: "video",
      controls: { platforms: ["instagram"] },
      brief: "The story of our kettle",
    });
    expect(first.videoKind).toBe("brand-story");
    expect(first.videoPeople).toBe("hands");
    expect(settleVideoControls({ type: "video", controls: first, brief: "x" }).videoPeople).toBe(
      "hands",
    );
  });

  it("never picks Premium on its own, but recommends it where it shines", () => {
    expect(studioVideoModelFor("brand-story", undefined)).toBe("standard");
    expect(studioVideoModelFor("brand-story", "premium")).toBe("premium");
    expect(recommendedModel("brand-story")).toBe("premium");
    expect(recommendedModel("brand-story", (k) => k !== "premium")).toBe("standard");
  });
});

describe("video lengths", () => {
  it("offers whole clips only", () => {
    expect(lengthChoices("standard", "brand-story")).toEqual([8, 16, 24, 32]);
    expect(lengthChoices("premium", "product-showcase")).toEqual([10, 20, 30, 40]);
    expect(lengthChoices("standard", "living-picture")).toEqual([8, 16, 24]);
    expect(lengthChoices("standard", "product-motion")).toEqual([8, 16, 24, 32]);
    for (const key of UGC_MODEL_KEYS)
      for (const kind of VIDEO_KINDS)
        for (const n of lengthChoices(key, kind.id)) expect(n % CLIP_SECONDS[key]).toBe(0);
  });

  it("defaults to a full ad of about 24 seconds, not a short clip", () => {
    expect(defaultLength("standard", "brand-story")).toBe(24);
    expect(defaultLength("standard", "product-motion")).toBe(24);
    expect(defaultLength("premium", "brand-story")).toBe(30);
    expect(defaultLength("standard", "living-picture")).toBe(8);
  });

  it("snaps old lengths to the nearest whole clips", () => {
    expect(snapLength(10, "standard", "brand-story")).toBe(8);
    expect(snapLength(12, "standard", "brand-story")).toBe(16);
    expect(snapLength(60, "standard", "brand-story")).toBe(32);
    expect(snapLength(undefined, "standard", "brand-story")).toBe(24);
  });

  it("never plans a clip shorter than the model makes", () => {
    expect(clipPlan(16, "standard")).toEqual([
      { start: 0, seconds: 8 },
      { start: 8, seconds: 8 },
    ]);
    expect(clipPlan(20, "premium").every((c) => c.seconds === 10)).toBe(true);
  });
});

const board = (over: Partial<VideoStoryboard> = {}): VideoStoryboard =>
  StoryboardSchema.parse({
    logline: "A tired barista finds the calm in her first pour of the day.",
    bible: {
      cast: [
        {
          id: "mia",
          look: "woman in her thirties, short dark curls, green apron, silver hoop earrings",
        },
      ],
      product: "matte black pour-over kettle",
      setting: "a small wooden cafe counter at dawn",
      lighting: "soft window light from the left, warm",
      palette: "cream, walnut, black",
      camera: "handheld 35mm, eye level",
    },
    clips: [
      {
        opensOn: "kettle steaming close up",
        shots: [
          {
            start: 0,
            end: 1.5,
            camera: "macro",
            action: "steam curls from the kettle spout",
            cast: [],
          },
          {
            start: 1.5,
            end: 8,
            camera: "push in",
            action: "mia lifts the kettle and starts the pour",
            cast: ["mia"],
          },
        ],
        endsOn: "mia mid-pour, coffee blooming in the filter",
        sound: "kettle hiss",
      },
      {
        opensOn: "mia mid-pour, coffee blooming in the filter",
        shots: [
          {
            start: 8,
            end: 12,
            camera: "slow orbit",
            action: "the bloom rises and settles",
            cast: [],
          },
          {
            start: 12,
            end: 16,
            camera: "static",
            action: "mia smiles and slides the cup forward",
            cast: ["mia"],
          },
        ],
        endsOn: "the full cup centred on the counter, still",
        sound: "cup set down",
      },
    ],
    ...over,
  });

const plan16 = clipPlan(16, "standard");
const ctx = { kind: "brand-story" as const, plan: plan16, knownFacts: "Pour-over cafe since 2015" };

describe("storyboard", () => {
  it("fits shots inside each clip, edge to edge", () => {
    const fitted = fitStoryboard(board(), plan16);
    for (const clip of fitted.clips) {
      expect(clip.shots[0].start).toBe(0);
      expect(clip.shots.at(-1)!.end).toBe(8);
      for (const shot of clip.shots) expect(shot.end).toBeGreaterThan(shot.start);
    }
  });

  it("passes a good storyboard", () => {
    expect(storyboardIssues(fitStoryboard(board(), plan16), ctx)).toEqual([]);
  });

  it("finds what the model must fix", () => {
    const bad = board({
      clips: [
        {
          opensOn: "",
          shots: [{ start: 0, end: 5, camera: "", action: "a slow start", cast: ["ghost"] }],
          endsOn: "",
          sound: "",
          onScreen: "Now 50% off for everyone today only",
          voiceover: "",
        },
      ],
    });
    const issues = storyboardIssues(bad, { ...ctx, competitors: ["Bluebottle"] });
    expect(issues.join(" ")).toMatch(/exactly 2 clip/);
    expect(issues.join(" ")).toMatch(/hook/);
    expect(issues.join(" ")).toMatch(/ends on/);
    expect(issues.join(" ")).toMatch(/ghost/);
    expect(issues.join(" ")).toMatch(/6 words/);
    expect(issues.join(" ")).toMatch(/"50"/);
  });

  it("refuses a cast when nobody may be on screen", () => {
    const issues = storyboardIssues(fitStoryboard(board(), plan16), { ...ctx, people: "none" });
    expect(issues.join(" ")).toMatch(/no people at all/);
    expect(
      storyboardIssues(fitStoryboard(board(), plan16), { ...ctx, people: "cast" }),
    ).toEqual([]);
  });

  it("keeps a voiceover short enough to say and true to the brand", () => {
    const sb = fitStoryboard(board(), plan16);
    sb.clips[0].voiceover = "Since 2015 we pour every cup by hand.";
    expect(storyboardIssues(sb, ctx)).toEqual([]);
    sb.clips[1].voiceover = `Now ${"really ".repeat(25)}calm, rated 99 by everyone.`;
    const issues = storyboardIssues(sb, ctx).join(" ");
    expect(issues).toMatch(/20 words or fewer/);
    expect(issues).toMatch(/"99"/);
  });

  it("speaks only a planned voiceover, and draws no words when code draws them", () => {
    const sb = fitStoryboard(board(), plan16);
    sb.clips[0].voiceover = "Every cup, by hand.";
    sb.clips[0].onScreen = "First pour";
    const opts = {
      kind: "product-motion" as const,
      plan: plan16,
      brandName: "Calm Cup",
      ratio: "9:16",
      chained: true,
      audio: true,
    };
    expect(clipPrompt(sb, 0, opts)).toMatch(/No narration/);
    const voiced = clipPrompt(sb, 0, { ...opts, voice: true, wordsByCode: true });
    expect(voiced).toContain('says, exactly: "Every cup, by hand."');
    expect(voiced).toMatch(/No words, captions or logos drawn on screen/);
    expect(clipPrompt(sb, 0, { ...opts, kind: "mood-broll", people: "none" })).toMatch(
      /PEOPLE \(this overrides/,
    );
  });

  it("refuses faces in a product showcase and competitor names", () => {
    const issues = storyboardIssues(board({ logline: "Better than Bluebottle." }), {
      ...ctx,
      kind: "product-showcase",
      competitors: ["Bluebottle"],
    });
    expect(issues.join(" ")).toMatch(/no faces/);
    expect(issues.join(" ")).toMatch(/Never name Bluebottle/);
  });

  it("an offer needs its exact end-card words", () => {
    const issues = storyboardIssues(fitStoryboard(board(), plan16), {
      ...ctx,
      kind: "offer-teaser",
    });
    expect(issues.join(" ")).toMatch(/end card/);
  });

  it("every clip carries the whole bible; only the first has the hook", () => {
    const sb = fitStoryboard(board(), plan16);
    const opts = {
      kind: "brand-story" as const,
      plan: plan16,
      brandName: "Calm Cup",
      ratio: "9:16",
      chained: true,
      audio: true,
    };
    const one = clipPrompt(sb, 0, opts);
    const two = clipPrompt(sb, 1, opts);
    for (const prompt of [one, two]) {
      expect(prompt).toContain("short dark curls");
      expect(prompt).toContain("soft window light");
    }
    expect(one).toMatch(/first second is the hook/);
    expect(two).not.toMatch(/first second is the hook/);
    expect(two).toMatch(/FIRST FRAME/);
    expect(one).toMatch(/not the end/);
    expect(two).toMatch(/end of the video/);
    expect(two).toContain("mia mid-pour");
  });

  it("summarises as timed lines over the whole video", () => {
    const text = storyboardSummary(fitStoryboard(board(), plan16), plan16);
    expect(text).toMatch(/\[8–/);
    expect(text).toMatch(/–16s\]/);
  });
});

describe("video checks", () => {
  it("samples every clip and every join", () => {
    const times = qaFrameTimes(plan16);
    expect(times).toHaveLength(6);
    expect(times.filter((t) => t.clip === 1)[0].time).toBeGreaterThan(8);
  });

  it("finds a short file, dead footage and missing sound", () => {
    const failures = technicalIssues(
      {
        duration: 11,
        width: 720,
        height: 1280,
        hasAudio: false,
        black: [{ start: 9, end: 10.5 }],
        frozen: [],
      },
      plan16,
      { audio: true },
    );
    expect(failures.map((f) => f.clip)).toEqual([1, 1, 1]);
    expect(
      technicalIssues(
        {
          duration: 16,
          width: 720,
          height: 1280,
          hasAudio: true,
          black: [],
          frozen: [{ start: 15.2, end: 16 }],
        },
        plan16,
        { audio: true },
      ),
    ).toEqual([]);
  });

  it("only scores decide; the judge never does", () => {
    const judge = VideoJudgeSchema.parse({
      clips: [
        { clip: 1, sameSubject: 9, clean: 9, followsPlan: 8, problem: "" },
        { clip: 2, sameSubject: 3, clean: 9, followsPlan: 8, problem: "Her hair turns blonde." },
      ],
      ending: 8,
      summary: "Looks great overall!",
    });
    const failures = visualFailures(judge, "brand-story", plan16);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ clip: 1 });
    expect(failures[0].reason).toMatch(/blonde/);
  });

  it("a living picture must keep the post", () => {
    const judge = VideoJudgeSchema.parse({
      clips: [{ clip: 1, sameSubject: 9, clean: 9, followsPlan: 9 }],
      ending: 3,
      sourceFaithful: 2,
    });
    const failures = visualFailures(judge, "living-picture", clipPlan(8, "standard"));
    expect(failures.map((f) => f.reason).join(" ")).toMatch(/post's picture/);
    expect(failures.map((f) => f.reason).join(" ")).not.toMatch(/ends cleanly/);
  });

  it("chained redos remake every clip after the first bad one, once", () => {
    const failures = [{ clip: 1, reason: "changes" }];
    expect(redoPlan(failures, 3, { chained: true, redone: 0 })?.clips).toEqual([1, 2]);
    expect(redoPlan(failures, 3, { chained: false, redone: 0 })?.clips).toEqual([1]);
    expect(redoPlan(failures, 3, { chained: true, redone: VIDEO_REDO_ROUNDS })).toBeNull();
    expect(redoPlan([], 3, { chained: true, redone: 0 })).toBeNull();
  });

  it("every kind is reachable from the table", () => {
    for (const kind of VIDEO_KINDS) expect(videoKind(kind.id)).toBe(kind);
  });
});
