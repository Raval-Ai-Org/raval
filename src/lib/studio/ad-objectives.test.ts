import { describe, expect, it } from "vitest";
import {
  AD_OBJECTIVES,
  AD_OBJECTIVE_IDS,
  adObjectiveDirective,
  getAdObjective,
  preferFormats,
  resolveAdObjective,
} from "./ad-objectives";
import { AD_FORMATS, getAdFormat, pickAdFormat } from "./ad-formats";
import { AdSchema } from "./prompts";

describe("ad objectives", () => {
  it("has one entry per stored id, each naming real layouts and three angles", () => {
    expect(AD_OBJECTIVES.map((o) => o.id)).toEqual([...AD_OBJECTIVE_IDS]);
    for (const o of AD_OBJECTIVES) {
      expect(o.angles).toHaveLength(3);
      expect(o.ctas.length).toBeGreaterThan(0);
      for (const id of o.formats) expect(getAdFormat(id), `${o.id} → ${id}`).not.toBeNull();
      // Without a product there is still a layout for every objective.
      expect(o.formats.some((id) => !getAdFormat(id)!.needsProduct)).toBe(true);
    }
  });

  it("keeps the person's choice", () => {
    expect(resolveAdObjective({ chosen: "event", brief: "20% off this week" }).id).toBe("event");
  });

  it("reads the brief before the goal", () => {
    expect(resolveAdObjective({ brief: "Get people to register for our webinar" }).id).toBe(
      "event",
    );
    expect(resolveAdObjective({ brief: "Book a free consultation", goal: "awareness" }).id).toBe(
      "leads",
    );
    expect(resolveAdObjective({ brief: "Win back people who abandoned cart" }).id).toBe("retarget");
    expect(resolveAdObjective({ brief: "Our summer collection", goal: "awareness" }).id).toBe(
      "awareness",
    );
  });

  it("defaults to selling", () => {
    expect(resolveAdObjective({ brief: "Our new mug" }).id).toBe("sales");
    expect(getAdObjective("nope")).toBeNull();
  });

  it("tells the writer it is a paid ad with the objective's angles and the policy rules", () => {
    const text = adObjectiveDirective(getAdObjective("retarget")!);
    expect(text).toContain("paid ad, not an organic post");
    expect(text).toContain("Proof, Doubt removed, Reason to come back");
    expect(text).toContain("personal attributes");
    expect(text).toContain("No invented urgency");
  });

  it("puts the objective's layouts first and never drops one", () => {
    const sorted = preferFormats(AD_FORMATS, getAdObjective("leads"));
    expect(sorted).toHaveLength(AD_FORMATS.length);
    expect(sorted[0].id).toBe("problem-question");
  });

  it("picks a layout the objective lists", () => {
    const objective = getAdObjective("event")!;
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const f = pickAdFormat({ objective, hasProduct: false, seed });
      expect(objective.formats).toContain(f.id);
    }
  });
});

describe("AdSchema search lines", () => {
  const variant = {
    label: "A",
    primaryText: "Hi",
    headline: "Hi",
    description: "",
    cta: "Shop now",
  };

  it("keeps lines within Google's limits and drops the rest", () => {
    const parsed = AdSchema.parse({
      title: "t",
      visualConcept: "v",
      variants: [variant, variant],
      search: {
        headlines: ["Cold brew in 5 minutes", "x".repeat(31), "Cold brew in 5 minutes"],
        descriptions: ["Order today and get it by Friday."],
      },
    });
    expect(parsed.search?.headlines).toEqual(["Cold brew in 5 minutes"]);
    expect(parsed.search?.descriptions).toEqual(["Order today and get it by Friday."]);
  });

  it("is optional", () => {
    const parsed = AdSchema.parse({ title: "t", visualConcept: "v", variants: [variant, variant] });
    expect(parsed.search).toBeUndefined();
  });
});
