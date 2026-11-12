import { describe, expect, it } from "vitest";
import { canvasPickers, missingFor, needsLine, startFor, startIdFor } from "./start";
import { rememberCreateSpot, takeCreateSpot, cameFromCreate } from "./create-return";

const uuid = "00000000-0000-4000-8000-000000000001";

describe("startIdFor", () => {
  it("reads each way of starting from the controls", () => {
    expect(startIdFor("image", {})).toBeNull();
    expect(startIdFor("video", {})).toBe("idea");
    expect(startIdFor("video", { videoMode: "brand" })).toBe("clips");
    expect(startIdFor("video", { videoMode: "recap" })).toBe("slideshow");
    expect(startIdFor("video", { videoMode: "recap", videoKind: "motion-post" })).toBe(
      "motion-post",
    );
    expect(startIdFor("video", { videoMode: "site" })).toBe("site");
    expect(startIdFor("video", { videoMode: "motion" })).toBe("motion-graphics");
    expect(startIdFor("video", { videoKind: "product-motion" })).toBe("product");
    expect(startIdFor("video", { videoKind: "offer-teaser" })).toBe("video-ad");
  });

  it("gives every start its own heading", () => {
    expect(startFor("video", { videoMode: "brand" })?.word).toBe("clips");
    expect(startFor("video", { videoMode: "site" })?.word).toBe("website");
    expect(needsLine("slideshow")).toBe("You add: 2 to 6 photos");
    expect(needsLine("idea")).toBe("Just describe it");
  });
});

describe("missingFor", () => {
  it("says what the server would refuse, before Generate", () => {
    expect(missingFor("video", { videoMode: "brand" })).toBe("Add at least one clip");
    expect(missingFor("video", { videoMode: "brand", sourceVideoAssetIds: [uuid] })).toBeNull();
    expect(missingFor("video", { videoMode: "recap", referenceAssetIds: [uuid] })).toBe(
      "Add one more photo",
    );
    expect(
      missingFor("video", {
        videoMode: "recap",
        videoKind: "motion-post",
        referenceAssetIds: [uuid],
      }),
    ).toBeNull();
    expect(missingFor("video", { videoMode: "site" })).toBe("Pick a page of your website");
    expect(missingFor("video", {})).toBeNull();
    expect(missingFor("image", {})).toBeNull();
  });
});

describe("canvasPickers", () => {
  it("puts what a start needs on the page", () => {
    expect(canvasPickers("video", { videoMode: "brand" }).source).toBe(true);
    expect(canvasPickers("video", { videoMode: "generate" }).source).toBe(false);
    expect(canvasPickers("video", { videoKind: "product-motion" }).product).toBe(true);
    expect(canvasPickers("ad", {}).adObjective).toBe(true);
    expect(canvasPickers("image", {})).toEqual({
      source: false,
      product: false,
      adObjective: false,
    });
  });
});

describe("create return spot", () => {
  it("returns to the list a place was opened from, once, and only for that place", () => {
    rememberCreateSpot("session-1", "posts");
    expect(cameFromCreate("session-1")).toBe(true);
    expect(takeCreateSpot("session-2")).toBeUndefined();
    expect(takeCreateSpot("session-1")).toBe("posts");
    expect(takeCreateSpot("session-1")).toBeUndefined();
    rememberCreateSpot("ugc", null);
    expect(takeCreateSpot("ugc")).toBeNull();
  });
});
