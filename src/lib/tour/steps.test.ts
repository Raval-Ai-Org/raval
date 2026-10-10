import { describe, expect, it } from "vitest";
import { TOUR_FINISH, placeCard, tourStops } from "./steps";

const VIEWPORT = { width: 1440, height: 900 };
const CARD = { width: 340, height: 220 };

describe("tour stops", () => {
  it("has unique ids and something to say at every stop", () => {
    const stops = tourStops({ autopilot: true });
    expect(new Set(stops.map((s) => s.id)).size).toBe(stops.length);
    for (const stop of stops) {
      expect(stop.title.length).toBeGreaterThan(3);
      expect(stop.body.length).toBeGreaterThan(10);
      // Short enough to read at a glance.
      expect(stop.body.length).toBeLessThanOrEqual(120);
      expect(stop.anchors.length).toBeGreaterThan(0);
    }
  });

  it("leaves Autopilot out when it is switched off", () => {
    expect(tourStops({ autopilot: true }).some((s) => s.id === "autopilot")).toBe(true);
    expect(tourStops({ autopilot: false }).some((s) => s.id === "autopilot")).toBe(false);
  });

  it("keeps the sidebar stops together, so the sidebar opens once", () => {
    const flags = tourStops({ autopilot: true }).map((s) => s.sidebar);
    const switches = flags.filter((flag, i) => i > 0 && flag !== flags[i - 1]).length;
    expect(switches).toBe(2);
  });

  it("offers three first steps at the end", () => {
    expect(TOUR_FINISH.map((a) => a.id)).toEqual(["post", "brain", "accounts"]);
  });
});

describe("placeCard", () => {
  it("centres the card when there is nothing to point at", () => {
    expect(placeCard(null, CARD, VIEWPORT, "right")).toEqual({
      left: 550,
      top: 340,
      side: "center",
    });
  });

  it("sits on the wanted side when it fits", () => {
    const target = { left: 8, top: 300, width: 224, height: 40 };
    const placed = placeCard(target, CARD, VIEWPORT, "right");
    expect(placed.side).toBe("right");
    expect(placed.left).toBe(8 + 224 + 14);
    expect(placed.top).toBe(300 + 20 - 110);
  });

  it("flips to the other side when the wanted one has no room", () => {
    const target = { left: 1300, top: 10, width: 90, height: 32 };
    const placed = placeCard(target, CARD, VIEWPORT, "top");
    expect(placed.side).toBe("bottom");
    expect(placed.top).toBe(10 + 32 + 14);
    // Kept inside the screen on the right edge.
    expect(placed.left).toBe(1440 - 340 - 12);
  });

  it("stays on screen on a phone, above or below the control", () => {
    const phone = { width: 390, height: 844 };
    const card = { width: 366, height: 230 };
    const inDrawer = { left: 8, top: 420, width: 304, height: 40 };
    const placed = placeCard(inDrawer, card, phone, "right");
    expect(["top", "bottom"]).toContain(placed.side);
    expect(placed.left).toBe(12);
    expect(placed.top).toBeGreaterThanOrEqual(12);
    expect(placed.top + card.height).toBeLessThanOrEqual(844 - 12);
    // Never on top of the control it points at.
    const overlaps = placed.top < inDrawer.top + inDrawer.height && placed.top + 230 > inDrawer.top;
    expect(overlaps).toBe(false);
  });

  it("never leaves the screen, even when the control fills it", () => {
    const huge = { left: 0, top: 0, width: 1440, height: 900 };
    const placed = placeCard(huge, CARD, VIEWPORT, "top");
    expect(placed.left).toBeGreaterThanOrEqual(12);
    expect(placed.top).toBeGreaterThanOrEqual(12);
    expect(placed.left + CARD.width).toBeLessThanOrEqual(1440 - 12);
    expect(placed.top + CARD.height).toBeLessThanOrEqual(900 - 12);
  });
});
