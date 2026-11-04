import { describe, expect, it } from "vitest";
import { activeNavId, NAV_GROUPS } from "./nav";

const items = NAV_GROUPS.flatMap((g) => g.items);

describe("workspace sidebar", () => {
  it("has unique ids and tour names", () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tours = items.flatMap((i) => (i.tour ? [i.tour] : []));
    expect(new Set(tours).size).toBe(tours.length);
  });

  it("keeps every place the app tour points at", () => {
    const tours = new Set(items.map((i) => i.tour));
    for (const name of [
      "brain",
      "inspo",
      "library",
      "campaigns",
      "calendar",
      "analytics",
      "visibility",
      "communities",
    ]) {
      expect(tours.has(name)).toBe(true);
    }
  });

  it("starts with Home and Chat, Holo style", () => {
    expect(NAV_GROUPS[0].items.map((i) => i.id)).toEqual(["home", "chat"]);
  });

  it("marks the row a path belongs to", () => {
    const home = "/w/abc/app";
    expect(activeNavId("/w/abc/app", home, false)).toBe("home");
    expect(activeNavId("/w/abc/app/", home, true)).toBe("chat");
    expect(activeNavId("/w/abc/app/chat/123", home, false)).toBe("chat");
    expect(activeNavId("/w/abc/app/brain", home, false)).toBe("brain");
    expect(activeNavId("/w/abc/app/inspo", home, false)).toBe("inspo");
    expect(activeNavId("/w/abc/app/autopilot", home, false)).toBeNull();
  });
});
