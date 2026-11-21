import { describe, expect, it } from "vitest";
import { copyIssue, genericPhrases } from "./copy-qa";

describe("copy QA", () => {
  it("finds generic AI phrasing", () => {
    expect(genericPhrases("Elevate your mornings. Say goodbye to bad coffee")).toEqual([
      "elevate",
      "say goodbye to",
    ]);
  });

  it("passes specific copy", () => {
    expect(
      copyIssue({
        onImageText: "Baked while you sleep",
        variants: [{ platform: "instagram", body: "Our sourdough is on the shelf by 7am." }],
      } as never),
    ).toBeNull();
  });

  it("flags generic captions, but keeps the person's own words", () => {
    const out = {
      variants: [{ platform: "instagram", body: "Unlock your best skin this winter." }],
    } as never;
    expect(copyIssue(out)).toMatch(/unlock/);
    expect(copyIssue(out, "a post: unlock your best skin")).toBeNull();
  });

  it("flags on-picture text too long to read", () => {
    expect(
      copyIssue({
        onImageText:
          "Our brand new winter collection is finally here and you will absolutely love every piece",
      } as never),
    ).toMatch(/too long/);
  });
});
