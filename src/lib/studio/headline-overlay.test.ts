import { describe, expect, it } from "vitest";
import {
  OVERLAY_SPACE_NOTE,
  overlayFontSize,
  overlayHeadline,
  overlayPlacement,
} from "./headline-overlay";

describe("headline overlay (Round 9, flag headline)", () => {
  it("sets the headline on the calmer band, bottom on a tie", () => {
    expect(overlayPlacement({ busy: 0.1, light: 0.5 }, { busy: 0.6, light: 0.5 }).at).toBe("top");
    expect(overlayPlacement({ busy: 0.6, light: 0.5 }, { busy: 0.1, light: 0.5 }).at).toBe(
      "bottom",
    );
    expect(overlayPlacement({ busy: 0.3, light: 0.5 }, { busy: 0.31, light: 0.5 }).at).toBe(
      "bottom",
    );
  });

  it("uses dark ink on a light band and light ink on a dark one", () => {
    expect(overlayPlacement({ busy: 0.9, light: 0.2 }, { busy: 0.1, light: 0.85 }).ink).toBe(
      "dark",
    );
    expect(overlayPlacement({ busy: 0.9, light: 0.9 }, { busy: 0.1, light: 0.2 }).ink).toBe(
      "light",
    );
  });

  it("sets short headlines big and long ones smaller, within bounds", () => {
    const short = overlayFontSize("Fresh daily", 1080);
    const long = overlayFontSize("Your cold brew goes flat by day three, here is why", 1080);
    expect(short).toBeGreaterThan(long);
    expect(long).toBeGreaterThanOrEqual(Math.round(1080 * 0.037));
    expect(short).toBeLessThanOrEqual(Math.round(1080 * 0.13));
  });

  it("only takes a real, short headline", () => {
    expect(overlayHeadline("  Fresh   daily ")).toBe("Fresh daily");
    expect(overlayHeadline("")).toBeNull();
    expect(overlayHeadline(null)).toBeNull();
    expect(
      overlayHeadline("one two three four five six seven eight nine ten eleven twelve thirteen"),
    ).toBeNull();
  });

  it("tells the image model to draw no words and leave a calm band", () => {
    expect(OVERLAY_SPACE_NOTE).toMatch(/no words/i);
    expect(OVERLAY_SPACE_NOTE).toMatch(/top third or the bottom third/);
  });
});
