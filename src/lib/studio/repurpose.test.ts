import { describe, expect, it } from "vitest";
import { STUDIO_FORMATS, type StudioType } from "./formats";
import { ANGLES, buildTextPrompt, emptyContext } from "./prompts";
import {
  animateOpen,
  animateStyles,
  carriedPlatforms,
  repurposeBrief,
  repurposeOpen,
  repurposeSourceFromJob,
  repurposeTargets,
  sourceLabelFor,
} from "./repurpose";

const TYPES = Object.keys(STUDIO_FORMATS) as StudioType[];

describe("making one piece from another", () => {
  it("offers every format something else, never itself", () => {
    for (const type of TYPES) {
      const targets = repurposeTargets(type, true);
      expect(targets.length).toBeGreaterThan(1);
      expect(targets.map((t) => t.type)).not.toContain(type);
    }
  });

  it("offers a video only from a finished picture", () => {
    expect(repurposeTargets("image", true)[0]).toMatchObject({ type: "video", animate: true });
    expect(
      repurposeTargets("image", true)
        .filter((t) => t.type === "video")
        .map((t) => t.videoKind),
    ).toEqual(["product-motion", "product-demo", "living-picture", "motion-post", "brand-story"]);
    expect(repurposeTargets("image", false).map((t) => t.type)).not.toContain("video");
    expect(repurposeTargets("article", true).map((t) => t.type)).not.toContain("video");
    // A script becomes a video through its own button, with its scenes.
    expect(repurposeTargets("script", true).map((t) => t.type)).not.toContain("video");
  });

  it("carries the channels the new format can use", () => {
    expect(carriedPlatforms(["linkedin", "instagram"], "carousel")).toEqual([
      "linkedin",
      "instagram",
    ]);
    expect(carriedPlatforms(["twitter"], "story")).toEqual(STUDIO_FORMATS.story.defaultPlatforms);
  });

  it("starts the composer from the source piece", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const carousel = repurposeOpen({
      from: "social",
      target: repurposeTargets("social", false)[0],
      contentItemId: id,
      title: "Summer menu",
      platforms: ["instagram"],
    });
    expect(carousel).toMatchObject({ type: "carousel", sourceContentId: id });
    expect(carousel.brief).toContain('"Summer menu"');
    expect(carousel.referenceAssetIds).toBeUndefined();
    const video = repurposeOpen({
      from: "image",
      target: repurposeTargets("image", true)[0],
      contentItemId: id,
      platforms: ["instagram"],
      picture: { assetId: "asset-1", ratio: "4:5" },
    });
    expect(video).toMatchObject({
      type: "video",
      referenceAssetIds: ["asset-1"],
      referenceMode: "preserve",
      ratio: "9:16",
      durationSec: 24,
      extraControls: { videoKind: "product-motion" },
    });
    expect(video.brief).toMatch(/No people/);
    const story = repurposeOpen({
      from: "image",
      target: repurposeTargets("image", true)[4],
      contentItemId: id,
      platforms: ["instagram"],
      picture: { assetId: "asset-1", ratio: "4:5" },
    });
    // A story from a post casts nobody new.
    expect(story.extraControls).toEqual({ videoKind: "brand-story", videoPeople: "source" });
    const motion = repurposeOpen({
      from: "image",
      target: repurposeTargets("image", true)[3],
      contentItemId: id,
      platforms: ["instagram"],
      picture: { assetId: "asset-1", ratio: "1:1" },
    });
    expect(motion.extraControls).toEqual({
      videoKind: "motion-post",
      videoMode: "recap",
      recapMotion: "camera",
    });
    expect(motion.durationSec).toBeUndefined();
    expect(repurposeBrief("social", "article", null)).toContain("into an article");
  });
});

describe("every text format reads the source piece", () => {
  const source = {
    kind: "post",
    title: "Summer menu",
    body: "Iced tea is back, 3 for 2 until Friday.",
  };
  const args = (type: StudioType) =>
    ({
      ctx: emptyContext("Cafe"),
      intent: { brief: "Turn my post into something new" },
      controls: { platforms: STUDIO_FORMATS[type].defaultPlatforms },
      angle: ANGLES[1],
      source,
    }) as never;

  for (const type of ["social", "carousel", "story", "article", "script", "ad"] as StudioType[]) {
    it(type, () => {
      const built = buildTextPrompt(type, args(type));
      const user = String(built.user);
      expect(user).toContain("3 for 2 until Friday");
      expect(user).toContain(`Make the ${STUDIO_FORMATS[type].noun} from this`);
      // Once, not twice.
      expect(user.split("3 for 2 until Friday").length).toBe(2);
    });
  }
});

describe("starting from a finished job", () => {
  const job = {
    type: "image" as StudioType,
    status: "succeeded" as const,
    title: "Summer menu",
    content_item_ids: ["ci-1"],
    input: { controls: { platforms: ["instagram"] } } as never,
    output: {
      title: "Summer menu",
      media: [{ slot: "main", kind: "image", status: "ready", assetId: "a-1", ratio: "4:5" }],
    } as never,
  };

  it("keeps the saved post, its picture and its channels", () => {
    const source = repurposeSourceFromJob(job);
    expect(source).toMatchObject({
      from: "image",
      contentItemId: "ci-1",
      picture: { assetId: "a-1", ratio: "4:5" },
      platforms: ["instagram"],
    });
    expect(sourceLabelFor("image", "Summer menu")).toBe('your image "Summer menu"');
  });

  it("offers nothing for a job that hasn't finished or saved a post", () => {
    expect(repurposeSourceFromJob({ ...job, status: "running" })).toBeNull();
    expect(repurposeSourceFromJob({ ...job, content_item_ids: [] })).toBeNull();
  });
});

describe("Home → Animate", () => {
  const style = (kind: string) => animateStyles().find((t) => t.videoKind === kind)!;

  it("offers every picture video, all as videos", () => {
    const styles = animateStyles();
    expect(styles.length).toBeGreaterThanOrEqual(4);
    expect(styles.every((s) => s.type === "video" && s.animate && s.videoKind)).toBe(true);
  });

  it("starts from the post when the picture has one, with the person's words last", () => {
    const open = animateOpen({
      picture: { assetId: "a1", ratio: "1:1", postId: "p1", title: "Summer", type: "ad" },
      target: style("living-picture"),
      note: "  add   a slow water splash ",
    });
    expect(open.sourceContentId).toBe("p1");
    expect(open.referenceAssetIds).toEqual(["a1"]);
    expect(open.referenceMode).toBe("preserve");
    expect(open.ratio).toBe("1:1");
    expect(open.brief.endsWith("add a slow water splash")).toBe(true);
    expect(open.extraControls?.videoKind).toBe("living-picture");
  });

  it("keeps an uploaded picture without a source post", () => {
    const open = animateOpen({
      picture: { assetId: "a2", type: "script" },
      target: style("motion-post"),
    });
    expect(open.sourceContentId).toBeUndefined();
    expect(open.sourceLabel).toBeUndefined();
    expect(open.type).toBe("video");
    expect(open.referenceAssetIds).toEqual(["a2"]);
    expect(open.extraControls).toMatchObject({ videoMode: "recap", recapMotion: "camera" });
  });

  it("keeps an end frame only for a style that ends on its picture", () => {
    const kept = animateOpen({
      picture: { assetId: "a1", type: "image" },
      target: style("living-picture"),
      endFrame: { assetId: "b2" },
    });
    expect(kept.extraControls?.endFrameAssetId).toBe("b2");
    expect(kept.brief).toContain("closing frame");
    const story = animateOpen({
      picture: { assetId: "a1", type: "image" },
      target: style("brand-story"),
      endFrame: { assetId: "b2" },
    });
    expect(story.extraControls?.endFrameAssetId).toBeUndefined();
    // The same picture at both ends is just the default return.
    const same = animateOpen({
      picture: { assetId: "a1", type: "image" },
      target: style("product-motion"),
      endFrame: { assetId: "a1" },
    });
    expect(same.extraControls?.endFrameAssetId).toBeUndefined();
  });

  it("uses the shape and length picked on the canvas", () => {
    const open = animateOpen({
      picture: { assetId: "a1", ratio: "9:16", type: "image" },
      target: style("living-picture"),
      ratio: "16:9",
      durationSec: 8,
    });
    expect(open.ratio).toBe("16:9");
    expect(open.durationSec).toBe(8);
    const motion = animateOpen({
      picture: { assetId: "a1", type: "image" },
      target: style("motion-post"),
      durationSec: 8,
    });
    expect(motion.durationSec).toBeUndefined();
  });
});
