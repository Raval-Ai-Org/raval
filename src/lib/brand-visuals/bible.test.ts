import { describe, expect, it } from "vitest";
import {
  BIBLE_RULES_LIMIT,
  bibleEmphasis,
  bibleRules,
  groundBible,
  groundProfile,
  pickAnchors,
} from "./bible";
import { BibleSchema, DirectionSchema, ProfileSchema, type VisualSource } from "./contracts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = (n: number, patch: Partial<VisualSource> = {}): VisualSource => ({
  id: id(n),
  workspace_id: id(99),
  asset_id: id(n + 100),
  kind: "upload",
  purpose: "style",
  status: "approved",
  label: "Example",
  notes: "",
  formats: [],
  campaign: null,
  source_url: null,
  capture_job_id: null,
  region: {},
  created_at: "2026-11-14T00:00:00Z",
  asset: { storage_path: `workspace/${id(99)}/a/${n}.png`, mime_type: "image/png" },
  ...patch,
});

const rawBible = {
  world: {
    medium: "Hand-painted watercolour illustration",
    rendering: "soft linework, paper grain",
    setting: "mountain lakes",
    lighting: "golden light",
    paletteMood: "warm cream and honey",
  },
  type: {
    headline: "High-contrast editorial serif",
    emphasis: "italic-accent",
    casing: "sentence case",
    placement: "top third",
  },
  composition: {
    logo: "top-centre",
    headlineZone: "top third",
    subjectZone: "lower two-thirds",
    density: "balanced",
  },
  signatures: [
    { kind: "card", description: "Floating product cards", sourceIds: [id(1)] },
    { kind: "motif", description: "Invented motif", sourceIds: [id(77)] },
  ],
  recurringSubject: { description: "A figure with a star head", sourceIds: [id(1), id(2)] },
  avoid: ["glossy 3D"],
  anchors: [id(1), id(3), id(77)],
};

describe("style bible schema", () => {
  it("parses old profiles without a bible and trims over-long model strings", () => {
    const old = ProfileSchema.parse({
      v: 1,
      directions: [{ name: "Old", summary: "Old look", visual: {} }],
    });
    expect(old.auto).toBe(false);
    expect(old.directions[0].bible).toBeUndefined();
    expect(old.directions[0].adherence).toBe("light");
    const long = BibleSchema.parse({ ...rawBible, world: { medium: "x".repeat(900) } });
    expect(long.world.medium).toHaveLength(200);
    expect(long.type.emphasis).toBe("italic-accent");
  });
  it("a broken bible never drops the direction", () => {
    const d = DirectionSchema.parse({ name: "A", summary: "B", visual: {}, bible: "nonsense" });
    expect(d.bible).toBeUndefined();
  });
});

describe("groundBible", () => {
  const bible = BibleSchema.parse(rawBible);
  it("keeps only ids the model really saw, and no UI crop as an example", () => {
    const kept = groundBible(bible, {
      analysed: new Set([id(1), id(2), id(3)]),
      roles: new Map([[id(3), "ui"]]),
      ownIds: new Set([id(1), id(2)]),
    })!;
    expect(kept.signatures.map((s) => s.description)).toEqual(["Floating product cards"]);
    expect(kept.anchors).toEqual([id(1)]);
    expect(kept.recurringSubject?.sourceIds).toEqual([id(1), id(2)]);
  });
  it("drops a recurring subject seen once, or only in someone else's post", () => {
    const kept = groundBible(bible, {
      analysed: new Set([id(1), id(2)]),
      roles: new Map(),
      ownIds: new Set([id(1)]),
    })!;
    expect(kept.recurringSubject).toBeUndefined();
  });
  it("orders directions by confidence and makes anchors part of the approved sources", () => {
    const profile = ProfileSchema.parse({
      v: 2,
      directions: [
        { name: "Weak", summary: "s", visual: {}, confidence: 0.3, bible: rawBible },
        { name: "Strong", summary: "s", visual: {}, confidence: 0.9, bible: rawBible },
      ],
    });
    const out = groundProfile(profile, {
      analysed: new Set([id(1), id(2)]),
      ownIds: new Set([id(1), id(2)]),
    });
    expect(out.directions.map((d) => d.name)).toEqual(["Strong", "Weak"]);
    expect(out.directions[0].sourceIds).toContain(id(1));
    expect(out.selected).toBe(0);
  });
});

describe("bibleRules", () => {
  const direction = (adherence: "light" | "close" | "strict") =>
    DirectionSchema.parse({ name: "World", summary: "s", visual: {}, adherence, bible: rawBible });
  it("light keeps world and type, leaves composition to Mellox's layouts", () => {
    const rules = bibleRules(direction("light"));
    expect(rules).toContain("watercolour");
    expect(rules).toContain("italics");
    expect(rules).not.toContain("Composition:");
    expect(rules).toContain("compose this picture freshly");
    expect(rules.length).toBeLessThanOrEqual(BIBLE_RULES_LIMIT);
  });
  it("close adds the composition, strict follows the examples' framing", () => {
    expect(bibleRules(direction("close"))).toContain("wordmark sits centred at the top");
    expect(bibleRules(direction("strict"))).toContain("framing and layout closely");
  });
  it("leaves type out of a picture with no words", () => {
    expect(bibleRules(direction("light"), { hasText: false })).not.toContain("Type:");
  });
  it("stays under the cap with every field at its longest", () => {
    const huge = DirectionSchema.parse({
      name: "W",
      summary: "s",
      visual: {},
      adherence: "strict",
      bible: {
        ...rawBible,
        world: Object.fromEntries(
          ["medium", "rendering", "setting", "lighting", "paletteMood"].map((k) => [
            k,
            "y".repeat(300),
          ]),
        ),
        signatures: Array.from({ length: 5 }, () => ({
          kind: "motif",
          description: "z".repeat(300),
          sourceIds: [id(1)],
        })),
        avoid: Array.from({ length: 6 }, () => "q".repeat(200)),
      },
    });
    expect(bibleRules(huge).length).toBeLessThanOrEqual(BIBLE_RULES_LIMIT);
  });
  it("maps the emphasis style", () => {
    expect(bibleEmphasis(BibleSchema.parse(rawBible))).toContain("italics");
    expect(bibleEmphasis(undefined)).toBeNull();
  });
});

describe("pickAnchors", () => {
  it("keeps two slots for the style examples even with product photos", () => {
    const direction = DirectionSchema.parse({
      name: "W",
      summary: "s",
      visual: {},
      sourceIds: [id(1), id(2)],
      bible: { ...rawBible, anchors: [id(1), id(2)] },
    });
    const sources = [
      source(1, { kind: "website", region: { type: "art" } }),
      source(2),
      source(3, { purpose: "product" }),
      source(4, { purpose: "product" }),
      source(5, { purpose: "product" }),
      source(6, { purpose: "avoid" }),
      source(7, { kind: "website", region: { type: "full" } }),
    ];
    const picked = pickAnchors(sources, { direction, format: "image" }).map((s) => s.id);
    expect(picked.slice(0, 2)).toEqual([id(1), id(2)]);
    expect(picked).toHaveLength(4);
    expect(picked).not.toContain(id(6));
    expect(picked).not.toContain(id(7));
  });
});
