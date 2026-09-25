// Style → prompt text. Pure, deterministic (stable order, so response caches
// hit), and capped. Brand DNA facts stay in serializeBrandContext; these blocks
// only describe *how* content reads and looks.
import type { ResolvedStyle } from "./resolve";
import type { StyleFormat } from "./spec";

export const WRITING_BLOCK_MAX = 2400;
export const VISUAL_BLOCK_MAX = 1800;
export const VIDEO_BLOCK_MAX = 1000;

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function toneWords(tone: NonNullable<ResolvedStyle["writing"]["tone"]>): string[] {
  const out: string[] = [];
  const pole = (v: number | undefined, low: string, high: string) => {
    if (v == null) return;
    if (v <= 20) out.push(`very ${low}`);
    else if (v <= 40) out.push(low);
    else if (v >= 80) out.push(`very ${high}`);
    else if (v >= 60) out.push(high);
  };
  pole(tone.casual, "formal", "casual");
  pole(tone.playful, "serious", "playful");
  pole(tone.detailed, "concise", "detailed");
  pole(tone.bold, "understated", "bold");
  return out;
}

const EMOJI_RULE = {
  none: "No emoji.",
  light: "At most one or two emoji.",
  heavy: "Emoji are welcome where they fit.",
} as const;

const CASING_RULE = {
  sentence: "Sentence case.",
  title: "Title Case for headlines.",
  lower: "all lowercase.",
  upper: "ALL CAPS for headlines.",
} as const;

const PERSON_RULE = {
  we: 'Speak as "we".',
  i: 'Speak in first person singular ("I").',
  you: 'Address the reader directly ("you").',
  brand: "Refer to the brand by name, third person.",
} as const;

/** Writing rules for text generation. Empty string when there's nothing to say. */
export function writingStyleBlock(resolved: ResolvedStyle, format?: StyleFormat | string): string {
  const w = resolved.writing;
  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`- ${label}: ${value.trim()}`);
  };
  push("Voice", w.voice);
  if (w.tone) {
    const words = toneWords(w.tone);
    if (words.length) push("Tone", words.join(", "));
  }
  if (w.sentenceLength) push("Sentences", w.sentenceLength);
  if (w.readingLevel) push("Reading level", w.readingLevel);
  if (w.person) push("Point of view", PERSON_RULE[w.person]);
  if (w.casing) push("Casing", CASING_RULE[w.casing]);
  if (w.emoji) {
    const fav =
      w.favoriteEmoji?.length && w.emoji !== "none" ? ` Prefer ${w.favoriteEmoji.join(" ")}.` : "";
    push("Emoji", EMOJI_RULE[w.emoji] + fav);
  }
  if (w.hashtags) {
    const bits: string[] = [];
    if (w.hashtags.count != null)
      bits.push(w.hashtags.count === 0 ? "no hashtags" : `about ${w.hashtags.count}`);
    if (w.hashtags.casing && w.hashtags.casing !== "any") bits.push(`${w.hashtags.casing}case`);
    if (w.hashtags.always?.length) bits.push(`always include ${w.hashtags.always.join(" ")}`);
    if (bits.length) push("Hashtags", bits.join("; "));
  }
  if (w.formatting) {
    const f = w.formatting;
    const bits: string[] = [];
    if (f.lineBreaks)
      bits.push(f.lineBreaks === "airy" ? "short lines with breaks" : "compact paragraphs");
    if (f.bullets != null) bits.push(f.bullets ? "bullets are fine" : "no bullets");
    if (f.maxChars) bits.push(`max ${f.maxChars} characters`);
    if (bits.length) push("Layout", bits.join("; "));
  }
  if (w.hooks?.length) push("Hook patterns", w.hooks.slice(0, 4).join(" | "));
  push("Call to action", w.cta);
  if (w.signaturePhrases?.length)
    push("Signature phrases (use naturally)", w.signaturePhrases.slice(0, 6).join(" | "));
  if (w.bannedWords?.length) push("Never use", w.bannedWords.slice(0, 30).join(", "));
  push("Language", w.language);
  const key = format === "carousel" ? "social" : format;
  if (key && w.perFormat && key in w.perFormat) {
    push(`For this ${format}`, w.perFormat[key as keyof typeof w.perFormat]);
  }
  if (resolved.rules.do) push("Do", resolved.rules.do.slice(0, 300));
  if (resolved.rules.dont) push("Don't", resolved.rules.dont.slice(0, 300));
  if (!lines.length && !w.examples?.length) return "";

  const head = resolved.name ? `## Writing style: ${resolved.name}` : "## Writing style";
  let out = [head, ...lines].join("\n");
  if (w.examples?.length) {
    const room = WRITING_BLOCK_MAX - out.length - 120;
    if (room > 200) {
      const per = Math.floor(room / w.examples.length);
      out += `\n\nExamples of this style (match the rhythm and phrasing, never copy the facts):\n${w.examples
        .map((e, i) => `<example ${i + 1}>\n${cap(e, per - 30)}\n</example>`)
        .join("\n")}`;
    }
  }
  return cap(out, WRITING_BLOCK_MAX);
}

/** Visual rules for image prompts. */
export function visualStyleBlock(resolved: ResolvedStyle): string {
  const v = resolved.visual;
  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  const p = v.palette;
  const roles = (
    [
      ["primary", p.primary],
      ["secondary", p.secondary],
      ["accent", p.accent],
      ["background", p.background],
      ["text", p.text],
    ] as const
  )
    .filter(([, h]) => h)
    .map(([r, h]) => `${r} ${h}`);
  if (p.extra?.length) roles.push(`extra ${p.extra.join(" ")}`);
  if (roles.length)
    push("Exact palette (use only these colours for design elements)", roles.join(", "));
  const t = v.typography ?? {};
  if (t.heading || t.body) {
    const bits = [
      t.heading ? `headline in ${t.heading}` : "",
      t.body && t.body !== t.heading ? `body in ${t.body}` : "",
      t.headingWeight ? `weight ${t.headingWeight}` : "",
      t.casing && t.casing !== "as-written" ? `${t.casing}case` : "",
      t.tracking && t.tracking !== "normal" ? `${t.tracking} letter spacing` : "",
    ].filter(Boolean);
    push("Typography", bits.join(", "));
  }
  push("Medium", v.medium);
  push("Mood", v.mood);
  push("Lighting", v.lighting);
  push("Colour grading", v.grading);
  push("Texture", v.texture);
  push("Composition", v.composition);
  if (v.textPlacement && v.textPlacement !== "none") push("Text placement", v.textPlacement);
  if (v.textPlacement === "none") push("Text on image", "none");
  push("Whitespace", v.whitespace);
  if (v.elements?.length) push("Graphic elements", v.elements.join(", "));
  if (v.textOnImage?.maxWords != null) push("Max words on image", String(v.textOnImage.maxWords));
  push("Text style", v.textOnImage?.style);
  push("Notes", v.notes);
  if (v.avoid?.length) push("Avoid", v.avoid.join(", "));
  if (!lines.length) return "";
  const head = resolved.name ? `VISUAL STYLE "${resolved.name}"` : "VISUAL STYLE";
  return cap(`${head}\n${lines.join("\n")}`, VISUAL_BLOCK_MAX);
}

/** Video rules for shot plans and video prompts. */
export function videoStyleBlock(resolved: ResolvedStyle): string {
  const v = resolved.video;
  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  push("Pacing", v.pacing);
  push("Shots", v.shots);
  push("Transitions", v.transitions);
  push("Hook", v.hook);
  if (v.captions) {
    const c = v.captions;
    if (c.show === false) push("On-screen captions", "none");
    else {
      const bits = [
        c.font ? `font ${c.font}` : "",
        c.color ? `colour ${c.color}` : "",
        c.highlight ? `highlight ${c.highlight}` : "",
        c.position ? `${c.position} of frame` : "",
        c.style ?? "",
      ].filter(Boolean);
      if (bits.length) push("On-screen captions", bits.join(", "));
    }
  }
  push("Intro", v.intro);
  push("Outro", v.outro);
  push("Music mood", v.music);
  push("Notes", v.notes);
  const pal = resolved.visual.palette;
  if (pal.primary)
    push("Brand colours", [pal.primary, pal.secondary, pal.accent].filter(Boolean).join(", "));
  if (resolved.visual.mood) push("Visual mood", resolved.visual.mood);
  if (!lines.length) return "";
  return cap(
    `VIDEO STYLE${resolved.name ? ` "${resolved.name}"` : ""}\n${lines.join("\n")}`,
    VIDEO_BLOCK_MAX,
  );
}

/** The block a text generator should see for a given output format. */
export function styleBlockFor(resolved: ResolvedStyle, format: StyleFormat | string): string {
  const parts = [writingStyleBlock(resolved, format)];
  if (format === "carousel" || format === "image" || format === "ad") {
    const visual = visualStyleBlock(resolved);
    if (visual)
      parts.push(
        `## Visual style\n${visual
          .split("\n")
          .slice(1)
          .map((l) => `- ${l}`)
          .join("\n")}`,
      );
  }
  if (format === "video" || format === "script" || format === "ugc") {
    const video = videoStyleBlock(resolved);
    if (video)
      parts.push(
        `## Video style\n${video
          .split("\n")
          .slice(1)
          .map((l) => `- ${l}`)
          .join("\n")}`,
      );
  }
  return parts.filter(Boolean).join("\n\n");
}

/** What an image prompt needs from a Style (consumed by buildImagePromptDetailed). */
export function imageStyleInput(
  resolved: ResolvedStyle,
  referenceCount = 0,
): {
  name: string | null;
  block: string;
  colors: string[];
  fonts: string[];
  maxWords?: number;
  logoCorner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  useLogo?: boolean;
  references?: { count: number; strength: "close" | "exact" };
} | null {
  const block = visualStyleBlock(resolved);
  const p = resolved.visual.palette;
  const colors = [
    p.primary,
    p.secondary,
    p.accent,
    p.background,
    p.text,
    ...(p.extra ?? []),
  ].filter((c): c is string => !!c);
  const t = resolved.visual.typography ?? {};
  const fonts = [t.heading, t.body].filter((f, i, all): f is string => !!f && all.indexOf(f) === i);
  if (!block && !colors.length && !fonts.length && !referenceCount) return null;
  const exact = resolved.references.some((r) => r.strength === "exact");
  return {
    name: resolved.name,
    block,
    colors,
    fonts,
    maxWords: resolved.visual.textPlacement === "none" ? 0 : resolved.visual.textOnImage?.maxWords,
    logoCorner: resolved.visual.logo?.corner,
    useLogo: resolved.visual.logo?.use,
    references: referenceCount
      ? { count: referenceCount, strength: exact ? "exact" : "close" }
      : undefined,
  };
}

/** Phrases, hashtags and emoji a style relies on — a rewrite must not drop them. */
export function styleProtectedTerms(resolved: ResolvedStyle): string[] {
  const w = resolved.writing;
  return [
    ...(w.signaturePhrases ?? []),
    ...(w.hashtags?.always ?? []).map((t) => `#${t.replace(/^#/, "")}`),
    ...(w.favoriteEmoji ?? []),
  ].filter(Boolean);
}

/**
 * One compact line of look and pacing for a UGC clip. UGC is phone footage, so
 * only what survives that: mood, light, grade, pacing, and brand colours as
 * set and wardrobe accents. Never on-screen text (the editor adds captions).
 */
export function ugcStyleNotes(resolved: ResolvedStyle): string {
  const v = resolved.visual;
  const p = v.palette;
  const bits = [
    v.mood && `mood ${v.mood}`,
    v.lighting && `lighting ${v.lighting}`,
    v.grading && `colour grade ${v.grading}`,
    resolved.video.pacing && `${resolved.video.pacing} pacing`,
    resolved.video.shots && `shots: ${resolved.video.shots}`,
    p.primary &&
      `brand colours ${[p.primary, p.secondary].filter(Boolean).join(" and ")} as subtle set or wardrobe accents`,
  ].filter(Boolean);
  return bits.join("; ").slice(0, 400);
}
