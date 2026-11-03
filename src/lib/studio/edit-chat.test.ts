import { describe, expect, it } from "vitest";
import { editTarget, planEdit } from "./edit-chat";

const image = { type: "image" as const, hasPicture: true };

describe("planEdit", () => {
  it("sends picture changes to the picture", () => {
    expect(planEdit("Make the background darker", image).aim).toBe("picture");
    expect(planEdit("show the product bigger", image).aim).toBe("picture");
  });

  it("sends word changes to the words", () => {
    expect(planEdit("Make the caption shorter", image).aim).toBe("words");
    expect(planEdit("add two hashtags", image).aim).toBe("words");
  });

  it("changes both when a message names both, or neither", () => {
    expect(planEdit("Brighter photo and a friendlier caption", image).aim).toBe("both");
    expect(planEdit("Make it feel more premium", image).aim).toBe("both");
  });

  it("treats a designed ad's headline as part of the picture", () => {
    const ad = { type: "ad" as const, hasPicture: true, designedAd: true };
    expect(planEdit("Change the headline to Summer is here", ad).aim).toBe("both");
    expect(
      planEdit("Change the headline to Summer is here", { ...ad, designedAd: false }).aim,
    ).toBe("words");
    expect(planEdit("shorter primary text", ad).aim).toBe("words");
  });

  it("asks for versions, with a count when one is given", () => {
    expect(planEdit("Show me 3 more versions", image)).toEqual({ aim: "versions", count: 3 });
    expect(planEdit("a few more options please", image)).toEqual({ aim: "versions" });
    expect(planEdit("give me two alternatives", image)).toEqual({ aim: "versions", count: 2 });
    expect(planEdit("9 variations", image)).toEqual({ aim: "versions", count: 4 });
  });

  it("never offers versions for a series or a piece without a picture", () => {
    expect(planEdit("more versions", { type: "carousel", hasPicture: true }).aim).not.toBe(
      "versions",
    );
    expect(planEdit("more versions", { type: "social", hasPicture: false }).aim).toBe("words");
    expect(planEdit("darker background", { type: "article", hasPicture: false }).aim).toBe("words");
  });
});

describe("editTarget", () => {
  it("maps each aim to the runner's refine target", () => {
    expect(editTarget("picture", "image")).toBe("media");
    expect(editTarget("versions", "ad")).toBe("variations");
    expect(editTarget("both", "ad")).toBe("all");
    expect(editTarget("words", "ad")).toBe("captions");
    expect(editTarget("words", "carousel")).toBe("all");
  });
});
