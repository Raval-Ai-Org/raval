import { describe, expect, it } from "vitest";
import {
  briefSections,
  briefVisualIdea,
  pictureJobFor,
  pictureRules,
  postTopic,
  preflightPictureBrief,
} from "./brief-visual";
import { hardImageDefects } from "./image-defects";

const SOCIAL_BRIEF = `Idea: Cold brew that tastes like dessert
Why now: Summer is here
Opening line: Your 3pm slump has a new rival.
What to say:
- Slow-steeped for 18 hours
- No added sugar
Image idea: A tall glass of cold brew on a sunlit marble counter, condensation running down, one vanilla pod beside it.
Hashtags: #coldbrew #summer`;

describe("briefSections", () => {
  it("reads labelled sections with their continuation lines", () => {
    const sections = briefSections(SOCIAL_BRIEF);
    expect(sections.get("what to say")).toContain("No added sugar");
    expect(sections.get("image idea")).toMatch(/^A tall glass/);
  });
});

describe("briefVisualIdea", () => {
  it("returns only the picture sections for the format", () => {
    const idea = briefVisualIdea(SOCIAL_BRIEF, "social");
    expect(idea).toMatch(/^Image idea: A tall glass/);
    expect(idea).not.toContain("3pm slump");
  });

  it("is empty for a person's own short brief", () => {
    expect(briefVisualIdea("a post about our summer drinks", "social")).toBe("");
  });
});

describe("postTopic", () => {
  it("prefers the title and strips tags and links", () => {
    expect(postTopic({ title: "Cold brew season #ad", caption: "x" })).toBe("Cold brew season");
    expect(
      postTopic({ title: "", caption: "Your slump has a rival. Try it at https://x.co today." }),
    ).toBe("Your slump has a rival.");
  });
});

describe("preflightPictureBrief", () => {
  const caption =
    "Your 3pm slump has a new rival. Slow-steeped for eighteen hours with no added sugar at all.";

  it("falls back to the brief's picture idea, then to the topic", () => {
    expect(
      preflightPictureBrief({ briefIdea: "Image idea: a glass", caption, topic: "Cold brew" })
        .scene,
    ).toBe("Image idea: a glass");
    expect(preflightPictureBrief({ caption, topic: "Cold brew" }).scene).toContain("Cold brew");
  });

  it("never lets a caption sentence into the scene", () => {
    const checked = preflightPictureBrief({
      scene:
        "A glass on marble. Slow-steeped for eighteen hours with no added sugar at all. Soft light.",
      caption,
      topic: "Cold brew",
    });
    expect(checked.scene).not.toContain("eighteen hours");
    expect(checked.notes).toContain("caption sentence removed from scene");
  });

  it("keeps a short banner headline and drops long or caption-copy ones", () => {
    expect(
      preflightPictureBrief({ scene: "s", headline: "Dessert in a glass", caption, topic: "t" })
        .headline,
    ).toBe("Dessert in a glass");
    expect(
      preflightPictureBrief({
        scene: "s",
        headline: "This is a far too long line for a banner picture",
        caption,
        topic: "t",
      }).headline,
    ).toBeNull();
    expect(
      preflightPictureBrief({
        scene: "s",
        headline: "Your 3pm slump has a new rival.",
        caption,
        topic: "t",
        maxWords: 8,
      }).headline,
    ).toBeNull();
    expect(
      preflightPictureBrief({ scene: "s", headline: "Sale", caption, topic: "t", maxWords: 0 })
        .headline,
    ).toBeNull();
  });

  it("drops a headline copy left in the scene", () => {
    expect(
      preflightPictureBrief({ scene: "A glass.\nText in visual: Big words", topic: "t" }).scene,
    ).toBe("A glass.");
  });
});

describe("off-topic pictures", () => {
  it("count as a defect worth the one redo", () => {
    expect(hardImageDefects(["The picture is off-topic: it shows a laptop"])).toHaveLength(1);
    expect(hardImageDefects(["Image is unrelated to the post topic"])).toHaveLength(1);
  });
});

describe("pictureJobFor", () => {
  it("follows the kind of post, not always a sale", () => {
    expect(pictureJobFor({ category: { id: "sale" } }).id).toBe("sell");
    expect(pictureJobFor({ category: { id: "this-or-that" } }).id).toBe("engage");
    expect(pictureJobFor({ category: { id: "tips" } }).id).toBe("teach");
    expect(pictureJobFor({ category: { id: "behind-scenes" } }).id).toBe("candid");
    expect(pictureJobFor({ category: { id: "proof" } }).id).toBe("proof");
  });

  it("falls back to the goal, then to a brand picture", () => {
    expect(pictureJobFor({ goal: "engagement" }).id).toBe("engage");
    expect(pictureJobFor({ goal: "offer" }).id).toBe("sell");
    expect(pictureJobFor({}).id).toBe("brand");
    expect(pictureJobFor({ type: "ad", category: { id: "tips" } }).id).toBe("sell");
  });

  it("never asks an engagement picture for a sales line", () => {
    const rules = pictureRules(pictureJobFor({ goal: "engagement" })).join("\n");
    expect(rules).toMatch(/never a sales line/);
    expect(rules).toMatch(/NEVER written on it/);
  });

  it("leads the scene with the picture's job and purpose", () => {
    const checked = preflightPictureBrief({
      scene: "Two mugs on a table.",
      topic: "t",
      purpose: "Coffee lovers · reply with their pick",
      job: pictureJobFor({ category: { id: "this-or-that" } }),
    });
    expect(checked.scene.split("\n")[0]).toMatch(/^Picture's job: A picture people want to answer/);
    expect(checked.scene).toContain("Purpose: Coffee lovers");
    expect(checked.scene).toMatch(/Two mugs on a table\.$/);
  });
});
