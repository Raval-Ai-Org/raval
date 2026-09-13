import { describe, expect, it } from "vitest";
import { STUDIO_TYPE_ORDER, isStudioType } from "@/lib/studio/formats";
import { ControlsSchema, IntentSchema } from "@/lib/studio/jobs";
import {
  POPULAR_TEMPLATE_IDS,
  STUDIO_TEMPLATES,
  countBlanks,
  firstBlank,
  getTemplate,
  templateDirective,
  templateFits,
  templatesFor,
} from "@/lib/studio/templates";

describe("studio templates", () => {
  it("have unique ids short enough to store", () => {
    const ids = STUDIO_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(40);
  });

  it("cover every format with at least four templates", () => {
    for (const type of STUDIO_TYPE_ORDER) {
      expect(templatesFor(type).length).toBeGreaterThanOrEqual(4);
    }
  });

  it("only target real formats and valid settings", () => {
    for (const t of STUDIO_TEMPLATES) {
      expect(t.types.length).toBeGreaterThan(0);
      for (const type of t.types) expect(isStudioType(type)).toBe(true);
      expect(t.beats.length).toBeGreaterThanOrEqual(3);
      if (t.controls) expect(ControlsSchema.partial().safeParse(t.controls).success).toBe(true);
    }
  });

  it("give every starter a blank to fill", () => {
    for (const t of STUDIO_TEMPLATES) {
      expect(countBlanks(t.starter)).toBeGreaterThan(0);
      const range = firstBlank(t.starter);
      expect(range).not.toBeNull();
      expect(t.starter.slice(range![0], range![1])).toMatch(/^\[.+\]$/);
    }
  });

  it("resolve popular ids and type fit", () => {
    for (const id of POPULAR_TEMPLATE_IDS) expect(getTemplate(id)).not.toBeNull();
    expect(templateFits("carousel-myth-fact", "carousel")).toBe(true);
    expect(templateFits("carousel-myth-fact", "article")).toBe(false);
    expect(templateFits(undefined, "social")).toBe(false);
  });

  it("build a prompt directive only for known templates", () => {
    expect(templateDirective(undefined)).toBeNull();
    expect(templateDirective("nope")).toBeNull();
    const d = templateDirective("carousel-myth-fact");
    expect(d).toContain("Follow this structure in order: Hook → Myth → Fact");
  });

  it("accept a template on the job intent, and still accept none", () => {
    expect(IntentSchema.safeParse({ brief: "Something useful" }).success).toBe(true);
    const parsed = IntentSchema.parse({ brief: "Something useful", template: "social-tips" });
    expect(parsed.template).toBe("social-tips");
  });
});
