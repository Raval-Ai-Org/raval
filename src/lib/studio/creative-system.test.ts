import { describe, expect, it } from "vitest";
import {
  TECHNIQUES,
  creativeSystemLines,
  mustBeClear,
  techniqueById,
  techniquesFor,
} from "./creative-system";

const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("creative system", () => {
  it("every technique has a how and a brand-neutral example", () => {
    expect(new Set(ids([...TECHNIQUES])).size).toBe(TECHNIQUES.length);
    for (const t of TECHNIQUES) {
      expect(t.how.length).toBeGreaterThan(20);
      expect(t.example.length).toBeGreaterThan(10);
    }
    expect(techniqueById("visual-metaphor")?.id).toBe("visual-metaphor");
    expect(techniqueById("nope")).toBeNull();
  });

  it("hiring stays clear: no visual metaphor or product drama", () => {
    const hiring = ids(techniquesFor({ deliverable: "hiring" }));
    expect(hiring[0]).toBe("clean-announcement");
    expect(hiring).not.toContain("visual-metaphor");
    expect(hiring).not.toContain("hero-drama");
    expect(mustBeClear("hiring")).toBe(true);
    expect(mustBeClear("launch")).toBe(false);
  });

  it("launches get big ideas, milestones a number, events an object pun", () => {
    expect(ids(techniquesFor({ deliverable: "launch" }))[0]).toBe("hero-drama");
    expect(ids(techniquesFor({ deliverable: "milestone" }))[0]).toBe("number-hero");
    expect(ids(techniquesFor({ deliverable: "event" }))[0]).toBe("object-pun");
  });

  it("a service brand gets a symbolic object; a trend leads with the culture tie", () => {
    expect(ids(techniquesFor({ service: true }))).toContain("symbolic-object");
    expect(ids(techniquesFor({ deliverable: "promo-offer", trend: true }))[0]).toBe("culture-tie");
  });

  it("the director lines carry the techniques and the house craft", () => {
    const text = creativeSystemLines({ deliverable: "launch" }).join("\n");
    expect(text).toContain("House craft");
    expect(text).toMatch(/hero/i);
  });
});
