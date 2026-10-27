import { describe, expect, it } from "vitest";
import { attachedImageMode, detectAttachedImageIntent, detectCreateIntent } from "./chat-intent";

describe("attached image creation intent", () => {
  it("keeps a supplied photo intact by default", () => {
    expect(attachedImageMode("Make an Instagram post using this photo")).toBe("preserve");
    expect(detectCreateIntent("Make an Instagram post using this photo")?.type).toBe("image");
  });

  it("keeps overlay-only requests out of image regeneration", () => {
    expect(attachedImageMode('Add the headline "Summer sale" to this image')).toBe("preserve");
  });

  it("uses targeted edits and inspiration only when explicitly requested", () => {
    expect(attachedImageMode("Change the background to a bright studio")).toBe("edit");
    expect(attachedImageMode("Add flowers around the product")).toBe("edit");
    expect(attachedImageMode("Add a border around the photo")).toBe("edit");
    expect(attachedImageMode("Create a new design inspired by this photo")).toBe("inspire");
    expect(detectAttachedImageIntent("Change the background to a bright studio")?.type).toBe(
      "image",
    );
  });
});
