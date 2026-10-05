// resolveLook — the brand's look merged with the Brand DNA facts behind it.
//
// Pure. The single shape every generator consumes (BrandLook). A field the look
// sets wins; a field it leaves empty comes from Brand DNA (colours, fonts,
// voice, logo, rules), so the look tracks later Brand DNA edits automatically.
import { normalizeHex, parseLook } from "./spec";
import type { StylePalette, VideoStyle, VisualStyle, WritingStyle } from "./spec";

export type ResolveDna = {
  brandName?: string | null;
  voice?: string | null;
  doRules?: string | null;
  dontRules?: string | null;
  colors?: Array<{ name?: string; hex: string }> | null;
  fonts?: string[] | null;
  logoUrl?: string | null;
  /** The stored look (BrandLookSpec); anything else is ignored. */
  look?: unknown;
};

export type BrandLook = {
  writing: WritingStyle;
  visual: VisualStyle & { palette: StylePalette };
  video: VideoStyle;
  rules: { do: string | null; dont: string | null };
  logoUrl: string | null;
  /** Something beyond plain Brand DNA facts was set (tone, image look, video…). */
  customized: boolean;
};

const isHex = (v: unknown): v is string =>
  typeof v === "string" && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim());

/** Map Brand DNA's ordered colour list onto palette roles. */
export function paletteFromDnaColors(colors: ResolveDna["colors"]): StylePalette {
  const hexes = (colors ?? [])
    .map((c) => c?.hex)
    .filter(isHex)
    .map(normalizeHex);
  if (!hexes.length) return {};
  const byName = (re: RegExp) => {
    const hit = (colors ?? []).find((c) => c?.name && re.test(c.name) && isHex(c.hex));
    return hit ? normalizeHex(hit.hex) : undefined;
  };
  const primary = byName(/primary|brand|main/i) ?? hexes[0];
  const rest = hexes.filter((h) => h !== primary);
  return {
    primary,
    secondary: byName(/secondary/i) ?? rest[0],
    accent: byName(/accent|highlight/i) ?? rest[1],
    background: byName(/background|bg|surface/i),
    text: byName(/text|ink|foreground/i),
    extra: rest.slice(2, 6),
  };
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out as T;
}

/**
 * A look complete enough to publish without a person looking first: colours,
 * a headline font, and a chosen image look and mood.
 */
export function lookReady(look: BrandLook): boolean {
  return !!(
    look.visual.palette.primary &&
    look.visual.typography?.heading &&
    look.visual.medium &&
    look.visual.mood?.trim()
  );
}

export function resolveLook(dna: ResolveDna | null | undefined): BrandLook {
  const d = dna ?? {};
  const spec = parseLook(d.look);

  const palette = compact({
    ...paletteFromDnaColors(d.colors),
    ...compact({ ...(spec.visual?.palette ?? {}) }),
  }) as StylePalette;

  const ownType = spec.visual?.typography ?? {};
  const dnaFonts = (d.fonts ?? []).filter(Boolean);
  const typography = compact({
    ...ownType,
    heading: ownType.heading || dnaFonts[0] || undefined,
    body: ownType.body || dnaFonts[1] || dnaFonts[0] || undefined,
  });

  const writing: WritingStyle = { ...(spec.writing ?? {}) };
  if (!writing.voice && d.voice) writing.voice = String(d.voice).slice(0, 600);

  return {
    writing,
    visual: { ...(spec.visual ?? {}), palette, typography },
    video: spec.video ?? {},
    rules: { do: d.doRules?.trim() || null, dont: d.dontRules?.trim() || null },
    logoUrl: d.logoUrl || null,
    customized: !!(spec.writing || spec.visual || spec.video),
  };
}
