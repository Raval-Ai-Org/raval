import { describe, expect, it } from "vitest";
import { VIDEO_KIND_IDS, videoKind } from "./kinds";
import { acceptsEndFrame, END_FRAME_KINDS } from "./end-frame";

describe("a chosen end frame", () => {
  it("is taken only by kinds that open on their picture and return to it", () => {
    for (const kind of END_FRAME_KINDS) expect(videoKind(kind).ending).toBe("back-to-source");
    expect(acceptsEndFrame("living-picture")).toBe(true);
    expect(acceptsEndFrame("product-motion")).toBe(true);
  });

  it("never replaces a story's or an offer's own ending", () => {
    for (const kind of VIDEO_KIND_IDS)
      if (!END_FRAME_KINDS.includes(kind)) expect(acceptsEndFrame(kind)).toBe(false);
    expect(acceptsEndFrame(undefined)).toBe(false);
  });
});
