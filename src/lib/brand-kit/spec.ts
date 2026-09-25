// Style spec — the shape of one Brand Kit Style (brand_styles.spec).
//
// Pure and browser-safe. Every field is optional so a style can be partly
// filled; `parseStyleSpec` never throws, it drops what doesn't fit and keeps
// the rest, because specs are also written by model analysis.
import { z } from "zod";

export const STYLE_SPEC_VERSION = 1;

export const STYLE_FORMATS = [
  "social",
  "carousel",
  "article",
  "script",
  "ad",
  "image",
  "video",
  "ugc",
] as const;
export type StyleFormat = (typeof STYLE_FORMATS)[number];

export const STYLE_FORMAT_LABELS: Record<StyleFormat, string> = {
  social: "Posts",
  carousel: "Carousels",
  article: "Articles",
  script: "Scripts",
  ad: "Ads",
  image: "Images",
  video: "Videos",
  ugc: "UGC videos",
};

export const KIT_ASSET_KINDS = [
  "logo",
  "logo_dark",
  "logo_mark",
  "font_file",
  "element",
  "pattern",
  "product_photo",
  "inspiration_image",
  "inspiration_video",
  "writing_sample",
] as const;
export type KitAssetKind = (typeof KIT_ASSET_KINDS)[number];

/** Kinds that are analysed to learn a style. */
export const ANALYZABLE_KINDS: ReadonlySet<KitAssetKind> = new Set([
  "inspiration_image",
  "inspiration_video",
  "writing_sample",
]);

const hex = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/)
  .transform(normalizeHex);
const short = (max: number) => z.string().trim().max(max);
const list = (max: number, len: number) => z.array(z.string().trim().min(1).max(len)).max(max);
const slider = z.number().min(0).max(100);

export function normalizeHex(value: string): string {
  let h = value.trim().replace(/^#/, "").toLowerCase();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return `#${h}`;
}

export const InheritSchema = z.object({
  colors: z.boolean().default(true),
  fonts: z.boolean().default(true),
  voice: z.boolean().default(true),
  logo: z.boolean().default(true),
  rules: z.boolean().default(true),
});
export type StyleInherit = z.infer<typeof InheritSchema>;
export const DEFAULT_INHERIT: StyleInherit = {
  colors: true,
  fonts: true,
  voice: true,
  logo: true,
  rules: true,
};

export const WritingSchema = z.object({
  voice: short(600).optional(),
  tone: z
    .object({
      casual: slider.optional(), // 0 formal ↔ 100 casual
      playful: slider.optional(), // 0 serious ↔ 100 playful
      detailed: slider.optional(), // 0 concise ↔ 100 detailed
      bold: slider.optional(), // 0 understated ↔ 100 bold
    })
    .optional(),
  sentenceLength: z.enum(["short", "mixed", "long"]).optional(),
  readingLevel: z.enum(["simple", "general", "expert"]).optional(),
  casing: z.enum(["sentence", "title", "lower", "upper"]).optional(),
  person: z.enum(["we", "i", "you", "brand"]).optional(),
  emoji: z.enum(["none", "light", "heavy"]).optional(),
  favoriteEmoji: list(8, 16).optional(),
  hashtags: z
    .object({
      count: z.number().int().min(0).max(30).optional(),
      casing: z.enum(["lower", "camel", "any"]).optional(),
      always: list(6, 60).optional(),
    })
    .optional(),
  hooks: list(6, 200).optional(),
  cta: short(300).optional(),
  formatting: z
    .object({
      lineBreaks: z.enum(["dense", "airy"]).optional(),
      bullets: z.boolean().optional(),
      maxChars: z.number().int().min(40).max(10_000).optional(),
    })
    .optional(),
  signaturePhrases: list(8, 120).optional(),
  bannedWords: list(30, 60).optional(),
  examples: list(3, 800).optional(),
  language: short(40).optional(),
  perFormat: z
    .object({
      social: short(400).optional(),
      article: short(400).optional(),
      script: short(400).optional(),
      ad: short(400).optional(),
    })
    .optional(),
});
export type WritingStyle = z.infer<typeof WritingSchema>;

export const PaletteSchema = z.object({
  primary: hex.optional(),
  secondary: hex.optional(),
  accent: hex.optional(),
  background: hex.optional(),
  text: hex.optional(),
  extra: z.array(hex).max(6).optional(),
});
export type StylePalette = z.infer<typeof PaletteSchema>;

export const TypographySchema = z.object({
  heading: short(60).optional(),
  body: short(60).optional(),
  accent: short(60).optional(),
  headingWeight: z.number().int().min(100).max(900).optional(),
  casing: z.enum(["as-written", "upper", "title", "lower"]).optional(),
  tracking: z.enum(["tight", "normal", "wide"]).optional(),
  /** Kit asset ids of uploaded font files, by role. */
  files: z
    .object({
      heading: z.string().uuid().optional(),
      body: z.string().uuid().optional(),
    })
    .optional(),
});
export type StyleTypography = z.infer<typeof TypographySchema>;

export const VisualSchema = z.object({
  palette: PaletteSchema.optional(),
  typography: TypographySchema.optional(),
  medium: z
    .enum(["photo", "illustration", "3d", "flat", "collage", "typographic", "mixed"])
    .optional(),
  mood: short(200).optional(),
  lighting: short(160).optional(),
  grading: short(160).optional(),
  texture: short(160).optional(),
  composition: short(300).optional(),
  textPlacement: z.enum(["top", "center", "bottom", "left", "right", "none"]).optional(),
  whitespace: z.enum(["minimal", "balanced", "generous"]).optional(),
  elements: list(8, 120).optional(),
  textOnImage: z
    .object({
      maxWords: z.number().int().min(0).max(40).optional(),
      style: short(200).optional(),
    })
    .optional(),
  logo: z
    .object({
      use: z.boolean().optional(),
      variant: z.enum(["logo", "logo_dark", "logo_mark"]).optional(),
      corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
    })
    .optional(),
  ratios: z
    .array(z.enum(["1:1", "4:5", "9:16", "16:9", "3:4"]))
    .max(5)
    .optional(),
  avoid: list(12, 120).optional(),
  notes: short(600).optional(),
});
export type VisualStyle = z.infer<typeof VisualSchema>;

export const VideoSchema = z.object({
  pacing: z.enum(["slow", "steady", "fast"]).optional(),
  shots: short(300).optional(),
  transitions: short(200).optional(),
  hook: short(300).optional(),
  captions: z
    .object({
      show: z.boolean().optional(),
      font: short(60).optional(),
      color: hex.optional(),
      highlight: hex.optional(),
      position: z.enum(["top", "center", "bottom"]).optional(),
      style: short(160).optional(),
    })
    .optional(),
  intro: short(200).optional(),
  outro: short(200).optional(),
  music: short(160).optional(),
  notes: short(600).optional(),
});
export type VideoStyle = z.infer<typeof VideoSchema>;

export const ReferenceSchema = z.object({
  assetId: z.string().uuid(),
  strength: z.enum(["loose", "close", "exact"]).default("close"),
});
export type StyleReference = z.infer<typeof ReferenceSchema>;

export const StyleSpecSchema = z.object({
  v: z.number().int().optional(),
  inherit: InheritSchema.partial().optional(),
  writing: WritingSchema.optional(),
  visual: VisualSchema.optional(),
  video: VideoSchema.optional(),
  references: z.array(ReferenceSchema).max(12).optional(),
  /** Field path → who set it. Analysis never overwrites a "user" field. */
  provenance: z.record(z.enum(["user", "analysis", "dna"])).optional(),
});
export type StyleSpec = z.infer<typeof StyleSpecSchema>;

export function emptySpec(): StyleSpec {
  return { v: STYLE_SPEC_VERSION, inherit: { ...DEFAULT_INHERIT } };
}

/**
 * Parse loosely: invalid sections are dropped section by section (and inside a
 * section, field by field) instead of failing the whole spec.
 */
export function parseStyleSpec(raw: unknown): StyleSpec {
  const out: StyleSpec = emptySpec();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  const pick = <T extends z.ZodRawShape>(schema: z.ZodObject<T>, value: unknown) => {
    if (!value || typeof value !== "object") return undefined;
    const whole = schema.safeParse(value);
    if (whole.success) return whole.data;
    const kept: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(schema.shape)) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      const r = (fieldSchema as z.ZodTypeAny).safeParse(v);
      if (r.success) kept[key] = r.data;
    }
    return kept as z.infer<z.ZodObject<T>>;
  };
  out.inherit = { ...DEFAULT_INHERIT, ...(pick(InheritSchema.partial(), obj.inherit) ?? {}) };
  const writing = pick(WritingSchema, obj.writing);
  if (writing && Object.keys(writing).length) out.writing = writing;
  const visual = pick(VisualSchema, obj.visual);
  if (visual && Object.keys(visual).length) out.visual = visual;
  const video = pick(VideoSchema, obj.video);
  if (video && Object.keys(video).length) out.video = video;
  if (Array.isArray(obj.references)) {
    out.references = obj.references
      .map((r) => ReferenceSchema.safeParse(r))
      .filter((r) => r.success)
      .map((r) => r.data!)
      .slice(0, 12);
  }
  const prov = z.record(z.enum(["user", "analysis", "dna"])).safeParse(obj.provenance);
  if (prov.success) out.provenance = prov.data;
  return out;
}

/** How "filled" a spec is, 0..1 — drives the card's progress ring. */
export function specCompleteness(spec: StyleSpec): number {
  const checks = [
    !!spec.writing?.voice,
    !!spec.writing?.tone,
    !!(spec.writing?.examples?.length || spec.writing?.hooks?.length),
    !!spec.visual?.palette?.primary,
    !!spec.visual?.typography?.heading,
    !!spec.visual?.medium,
    !!spec.visual?.mood,
    !!spec.visual?.composition,
    !!spec.video?.pacing,
    !!spec.references?.length,
  ];
  return checks.filter(Boolean).length / checks.length;
}
