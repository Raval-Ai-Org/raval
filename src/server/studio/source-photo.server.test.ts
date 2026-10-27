import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  composeSourcePhoto,
  sourcePhotoOverlayText,
  sourcePhotoWantsLogo,
} from "./source-photo.server";

describe("source photo preservation", () => {
  it("does not invent an overlay for an ordinary post request", () => {
    expect(
      sourcePhotoOverlayText("Make an Instagram post using this photo", { title: "New post" }),
    ).toBeNull();
  });

  it("uses exact quoted copy only when an overlay was requested", () => {
    expect(
      sourcePhotoOverlayText('Add the headline "Summer sale" to this photo', { title: "Other" }),
    ).toBe("Summer sale");
    expect(sourcePhotoWantsLogo("Please add our logo in the corner")).toBe(true);
  });

  it("falls back past an empty model suggestion", () => {
    expect(
      sourcePhotoOverlayText("Add a headline to this photo", {
        title: "Launch day",
        onImageText: "",
      }),
    ).toBe("Launch day");
  });

  it("keeps the complete source visible inside the requested canvas", async () => {
    const source = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const output = await composeSourcePhoto({ bytes: source, ratio: "1:1", text: "Launch day" });
    await expect(sharp(output).metadata()).resolves.toMatchObject({
      width: 1080,
      height: 1080,
      format: "png",
    });
  });
});
