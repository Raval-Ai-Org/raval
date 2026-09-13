import { describe, expect, it } from "vitest";
import { detectStudioType } from "@/lib/studio/detect";

describe("detectStudioType", () => {
  it.each([
    ["A carousel with 5 cold brew tips", "carousel"],
    ["Write a TikTok script about grind size", "script"],
    ["video script for our launch", "script"],
    ["A blog post on decaf", "article"],
    ["Facebook ads for the gift subscription", "ad"],
    ["A short video of the roastery at dawn", "video"],
    ["Product photo of our new bag", "image"],
    ["LinkedIn post about sourcing", "social"],
    ["Step-by-step guide slides for home brewers", "carousel"],
  ])("%s → %s", (text, type) => {
    expect(detectStudioType(text)).toBe(type);
  });

  it("stays out of the way when nothing matches", () => {
    expect(detectStudioType("Tell people why we pay farmers more")).toBeNull();
    expect(detectStudioType("ad")).toBeNull();
    expect(detectStudioType("We made it")).toBeNull();
  });
});
