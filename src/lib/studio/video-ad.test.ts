import { describe, expect, it } from "vitest";
import {
  animateBrief,
  animateImageDirection,
  canAnimatePiece,
  platformVideoNote,
  videoBeats,
  videoRatioForImage,
} from "./video-ad";
import { buildVisualBriefPrompt, emptyContext } from "./prompts";

describe("videoBeats", () => {
  it.each([4, 5, 6, 8, 10, 15, 30, 60])("covers all %i seconds in order with no gaps", (d) => {
    const beats = videoBeats(d);
    expect(beats[0].start).toBe(0);
    expect(beats.at(-1)!.end).toBe(d);
    expect(beats[0].role).toBe("hook");
    expect(beats.at(-1)!.role).toBe("payoff");
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].start).toBe(beats[i - 1].end);
      expect(beats[i].end).toBeGreaterThan(beats[i].start);
    }
  });

  it("opens with a hook of at most two seconds", () => {
    for (const d of [4, 8, 15, 60]) expect(videoBeats(d)[0].end).toBeLessThanOrEqual(2);
  });

  it("has no room for a separate why beat in a very short clip", () => {
    expect(videoBeats(5).map((b) => b.role)).toEqual(["hook", "payoff"]);
    expect(videoBeats(8).map((b) => b.role)).toEqual(["hook", "show", "why", "payoff"]);
  });
});

describe("animating a post's picture", () => {
  it("is offered for picture pieces only", () => {
    expect(["image", "social", "ad", "story"].every(canAnimatePiece)).toBe(true);
    expect(["video", "article", "script", "carousel"].some(canAnimatePiece)).toBe(false);
  });

  it("keeps square and landscape pictures, and makes the rest vertical", () => {
    expect(videoRatioForImage("1:1")).toBe("1:1");
    expect(videoRatioForImage("16:9")).toBe("16:9");
    expect(videoRatioForImage("4:5")).toBe("9:16");
    expect(videoRatioForImage(undefined)).toBe("9:16");
  });

  it("asks the renderer to open on the exact picture and keep its words", () => {
    const text = animateImageDirection(8);
    expect(text).toMatch(/first frame/);
    expect(text).toMatch(/stay perfectly still/);
    expect(text).toMatch(/connected shots/);
    expect(animateImageDirection(5)).toMatch(/own framing/);
  });

  it("writes a plain brief naming the piece", () => {
    expect(animateBrief({ type: "ad", title: "Summer serum" })).toMatch(/my ad "Summer serum"/);
    expect(animateBrief({ type: "social" })).toMatch(/my post picture into/);
  });

  it("notes each platform's habits", () => {
    expect(platformVideoNote(["tiktok"])).toMatch(/TikTok/);
    expect(platformVideoNote(["linkedin"])).toMatch(/calm/);
    expect(platformVideoNote([])).toBe("");
  });
});

describe("video brief prompt", () => {
  const base = {
    ctx: emptyContext("Acme"),
    intent: { brief: "Show our new serum" },
    controls: { platforms: ["instagram"], durationSec: 8 },
    angle: { id: "a", label: "A", directive: "" },
  } as unknown as Parameters<typeof buildVisualBriefPrompt>[0];

  it("plans on the beats and the video ad rules", () => {
    const built = buildVisualBriefPrompt({ ...base, medium: "video" });
    expect(built.system).toMatch(/\[0–1\.2s\] hook/);
    expect(built.system).toMatch(/first second is the hook/);
    expect(built.system).toMatch(/Reels/);
    expect(built.system).not.toMatch(/starts from the brand's finished post/);
  });

  it("animates the post's picture when the video is made from a post", () => {
    const built = buildVisualBriefPrompt({
      ...base,
      medium: "video",
      source: { kind: "social", title: "Serum launch", body: "Glow in 7 days" },
    });
    expect(built.system).toMatch(/starts from the brand's finished post/);
    expect(built.user).toMatch(/The post this video is made from/);
  });

  it("leaves a script source as a script", () => {
    const built = buildVisualBriefPrompt({
      ...base,
      medium: "video",
      source: { kind: "script", title: "S", body: "scene" },
    });
    expect(built.system).not.toMatch(/starts from the brand's finished post/);
  });

  it("leaves picture briefs alone", () => {
    const built = buildVisualBriefPrompt({ ...base, medium: "image" });
    expect(built.system).not.toMatch(/first second is the hook/);
  });
});
