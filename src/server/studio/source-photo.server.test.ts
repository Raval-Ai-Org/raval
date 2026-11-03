import { describe, expect, it } from "vitest";
import { sourcePhotoWantsLogo } from "./source-photo.server";
import { asksForDesign } from "@/lib/studio/photo-design/mode";

describe("source photo preservation", () => {
  it("adds only the logo when that is all that was asked", () => {
    expect(sourcePhotoWantsLogo("Please add our logo in the corner")).toBe(true);
    expect(sourcePhotoWantsLogo("Make an Instagram post using this photo")).toBe(false);
  });

  it("sends words on a photo to a photo design instead of a template", () => {
    expect(asksForDesign('Add the headline "Summer sale" to this photo')).toBe(true);
    expect(asksForDesign("Please add our logo in the corner")).toBe(false);
    expect(asksForDesign("Make an Instagram post using this photo")).toBe(false);
    expect(asksForDesign("Write a caption for this photo")).toBe(false);
    expect(asksForDesign("put the caption on the photo")).toBe(true);
  });
});
