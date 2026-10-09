import { describe, expect, it } from "vitest";
import { pickCarouselStructure, structureFromBrief } from "./carousel/story";
import { ANGLES, pickAngle } from "./prompts";
import {
  AIM_ANGLES,
  aimLine,
  aimSequence,
  formatGuide,
  shareAim,
  shareRules,
  shareSection,
  weightedSequence,
} from "./viral";

describe("weightedSequence", () => {
  it("gives each id its share and spreads them out", () => {
    const out = weightedSequence({ a: 3, b: 2, c: 1 }, 12);
    expect(out.filter((x) => x === "a")).toHaveLength(6);
    expect(out.filter((x) => x === "b")).toHaveLength(4);
    expect(out.filter((x) => x === "c")).toHaveLength(2);
    // Never three of the same in a row while others are due.
    for (let i = 2; i < out.length; i++) {
      expect(out[i] === out[i - 1] && out[i] === out[i - 2]).toBe(false);
    }
  });

  it("carries on from an offset instead of starting again", () => {
    const whole = weightedSequence({ a: 3, b: 2, c: 1 }, 10);
    expect(weightedSequence({ a: 3, b: 2, c: 1 }, 5, 5)).toEqual(whole.slice(5));
  });

  it("returns nothing for no weights or no count", () => {
    expect(weightedSequence({}, 4)).toEqual([]);
    expect(weightedSequence({ a: 1 }, 0)).toEqual([]);
  });
});

describe("aims", () => {
  it("mixes what posts are for, led by the goal", () => {
    const leads = aimSequence("leads", 7).map((a) => a.id);
    expect(new Set(leads).size).toBeGreaterThan(2);
    expect(leads.filter((id) => id === "save").length).toBeGreaterThanOrEqual(3);
    const engagement = aimSequence("engagement", 8).map((a) => a.id);
    expect(engagement.filter((id) => id === "reply" || id === "relate").length).toBe(6);
  });

  it("falls back to reach for an unknown goal", () => {
    expect(aimSequence("nonsense", 3).map((a) => a.id)).toEqual(
      aimSequence("awareness", 3).map((a) => a.id),
    );
  });

  it("writes the aim as one line for a brief", () => {
    expect(aimLine(shareAim("save"))).toContain("worth saving");
    expect(aimLine(null)).toBe("");
    expect(shareAim("made-up")).toBeNull();
  });
});

describe("rules", () => {
  it("adds the picture rule to visual formats and the search rule where people search", () => {
    const text = shareRules("social", ["linkedin"]);
    const carousel = shareRules("carousel", ["instagram"]);
    expect(carousel.length).toBe(text.length + 2);
    expect(carousel.join(" ")).toMatch(/sound off/);
    expect(carousel.join(" ")).toMatch(/searching/);
  });

  it("never asks for bait", () => {
    expect(shareSection("social")).toMatch(/No bait/);
  });

  it("leaves an article alone", () => {
    expect(shareSection("article")).toBe("");
  });

  it("explains only the formats on offer", () => {
    const guide = formatGuide(["social", "carousel", "carousel"]);
    expect(guide.split("\n")).toHaveLength(2);
    expect(guide).toMatch(/^- social:/);
  });
});

describe("a planned piece is the piece that gets made", () => {
  it("keeps the angle to what the piece is for, and still rotates", () => {
    const save = AIM_ANGLES.save;
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      expect(save).toContain(pickAngle(seed, [], undefined, save).id);
    }
    // The ones used lately are avoided while another fits.
    const next = pickAngle("seed", ["how-to", "checklist", "myth"], undefined, save);
    expect(next.id).toBe("comparison");
    // Nothing allowed: the old behaviour.
    expect(pickAngle("seed", [], "proof").id).toBe("proof");
  });

  it("every aim points at angles that exist", () => {
    const ids = new Set(ANGLES.map((a) => a.id));
    for (const list of Object.values(AIM_ANGLES)) {
      expect(list.length).toBeGreaterThan(1);
      for (const id of list) expect(ids.has(id)).toBe(true);
    }
  });

  it("gives a carousel the structure its brief names", () => {
    expect(structureFromBrief("A four-step checklist for Reddit\n\nBreak it down.")).toBe(
      "checklist",
    );
    expect(structureFromBrief("How to audit your schema")).toBe("steps");
    expect(structureFromBrief("5 signs your beans are stale")).toBe("list");
    expect(structureFromBrief("Three myths about AI search")).toBe("myths");
    expect(structureFromBrief("Our autumn menu")).toBeNull();
    // Only the title and the idea are read, never the context after them.
    expect(
      structureFromBrief("Our autumn menu\n\nShow it.\n\nMarket: a checklist trend"),
    ).toBeNull();
    const picked = pickCarouselStructure({
      seed: "x",
      angleId: "contrarian",
      brief: "A four-step checklist for Reddit",
      recent: ["checklist"],
    });
    expect(picked.id).toBe("checklist");
    // A revision keeps what it had.
    expect(pickCarouselStructure({ seed: "x", preferred: "myths", brief: "a checklist" }).id).toBe(
      "myths",
    );
  });
});
