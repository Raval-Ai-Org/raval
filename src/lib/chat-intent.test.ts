import { describe, expect, it } from "vitest";
import {
  attachedImageMode,
  attachedPhotoChoice,
  detectAttachedClipIntent,
  detectAttachedImageIntent,
  detectCreateIntent,
  detectRepurposeIntent,
} from "./chat-intent";

describe("attached image creation intent", () => {
  it("keeps a supplied photo intact by default", () => {
    expect(attachedImageMode("Make an Instagram post using this photo")).toBe("preserve");
    expect(detectCreateIntent("Make an Instagram post using this photo")?.type).toBe("image");
    expect(attachedImageMode("Post this as it is")).toBe("preserve");
    expect(attachedImageMode("Add our logo to this")).toBe("preserve");
  });

  it("designs around the photo when words or elements are asked for", () => {
    expect(attachedImageMode('Add the headline "Summer sale" to this image')).toBe("design");
    expect(attachedImageMode("Add a border around the photo")).toBe("design");
    const plumbing =
      "This is my picture of my workforce doing plumbing, please use this and add text and elements";
    expect(attachedPhotoChoice(plumbing)).toEqual({ mode: "design" });
    expect(detectAttachedImageIntent(plumbing)?.type).toBe("image");
  });

  it("designs with several photos, and repaints only when asked", () => {
    expect(attachedPhotoChoice("Make a post from our launch event", 4)).toEqual({ mode: "design" });
    expect(attachedPhotoChoice("Blend these into one illustrated poster", 2)).toEqual({
      mode: "design",
      fidelity: "blend",
    });
  });

  it("uses targeted edits and inspiration only when explicitly requested", () => {
    expect(attachedImageMode("Change the background to a bright studio")).toBe("edit");
    expect(attachedImageMode("Add flowers around the product")).toBe("edit");
    expect(attachedImageMode("Create a new design inspired by this photo")).toBe("inspire");
    expect(detectAttachedImageIntent("Change the background to a bright studio")?.type).toBe(
      "image",
    );
  });

  it("treats attached clips as a video to brand", () => {
    expect(detectAttachedClipIntent("Brand this clip with our logo")?.type).toBe("video");
    expect(detectAttachedClipIntent("What do you think of this clip?")).toBeNull();
  });
});

describe("making a new piece from the last one", () => {
  it("reads the new format, not the old one", () => {
    expect(detectRepurposeIntent("Turn this into a carousel")?.type).toBe("carousel");
    expect(detectRepurposeIntent("Make a Story from it")?.type).toBe("story");
    expect(detectRepurposeIntent("Make a post from this carousel")?.type).toBe("social");
    expect(detectRepurposeIntent("Turn my last post into an article")?.type).toBe("article");
    expect(detectRepurposeIntent("can you turn that into an ad?")?.type).toBe("ad");
  });

  it("leaves new material and questions alone", () => {
    expect(detectRepurposeIntent("Make a carousel from this list: tea, cake, scones")).toBeNull();
    expect(detectRepurposeIntent("Why did you turn this into a carousel?")).toBeNull();
    expect(detectRepurposeIntent("Make a carousel about our summer menu")).toBeNull();
    expect(detectRepurposeIntent("I like it a lot, thanks")).toBeNull();
  });
});
