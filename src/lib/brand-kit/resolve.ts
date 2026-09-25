// resolveStyle — merge a Style with the Brand DNA it inherits from.
//
// Pure. The single shape every generator consumes (ResolvedStyle). A field the
// Style sets always wins; a field it leaves empty falls back to Brand DNA only
// when that field's `inherit` toggle is on, so an inherited field tracks later
// Brand DNA edits automatically.
import { normalizeHex, parseStyleSpec } from "./spec";
import type { StylePalette, StyleSpec, VideoStyle, VisualStyle, WritingStyle } from "./spec";

export type ResolveDna = {
  brandName?: string | null;
  voice?: string | null;
  doRules?: string | null;
  dontRules?: string | null;
  colors?: Array<{ name?: string; hex: string }> | null;
  fonts?: string[] | null;
  logoUrl?: string | null;
};

export type StyleRow = {
  id: string;
  name: string;
  version: number;
  spec: unknown;
  applies_to?: string[] | null;
};

export type ResolvedStyle = {
  /** null = no Style chosen: Brand DNA only. */
  styleId: string | null;
  name: string | null;
  version: number | null;
  appliesTo: string[];
  writing: WritingStyle;
  visual: VisualStyle & { palette: StylePalette };
  video: VideoStyle;
  references: NonNullable<StyleSpec["references"]>;
  rules: { do: string | null; dont: string | null };
  /** Where the logo comes from: a kit asset (by variant) or the DNA URL. */
  logo: { source: "kit" | "dna" | null; dnaUrl: string | null };
  /** Which fields came from Brand DNA — shown as "Linked" in the UI. */
  fromDna: { colors: boolean; fonts: boolean; voice: boolean; logo: boolean; rules: boolean };
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

export function resolveStyle(
  dna: ResolveDna | null | undefined,
  style: StyleRow | null | undefined,
): ResolvedStyle {
  const spec = parseStyleSpec(style?.spec);
  const inherit = {
    colors: true,
    fonts: true,
    voice: true,
    logo: true,
    rules: true,
    ...spec.inherit,
  };
  const d = dna ?? {};

  const ownPalette = compact({ ...(spec.visual?.palette ?? {}) });
  const dnaPalette = inherit.colors ? paletteFromDnaColors(d.colors) : {};
  const palette = compact({ ...dnaPalette, ...ownPalette }) as StylePalette;

  const ownType = spec.visual?.typography ?? {};
  const dnaFonts = inherit.fonts ? (d.fonts ?? []).filter(Boolean) : [];
  const typography = compact({
    ...ownType,
    heading: ownType.heading || dnaFonts[0] || undefined,
    body: ownType.body || dnaFonts[1] || dnaFonts[0] || undefined,
  });

  const writing: WritingStyle = { ...(spec.writing ?? {}) };
  const voiceFromDna = !writing.voice && inherit.voice && !!d.voice;
  if (voiceFromDna) writing.voice = String(d.voice).slice(0, 600);

  const rules = inherit.rules
    ? { do: d.doRules?.trim() || null, dont: d.dontRules?.trim() || null }
    : { do: null, dont: null };

  const kitLogo = spec.visual?.logo?.variant ? "kit" : null;
  const dnaLogo = inherit.logo && d.logoUrl ? d.logoUrl : null;

  return {
    styleId: style?.id ?? null,
    name: style?.name ?? null,
    version: style?.version ?? null,
    appliesTo: style?.applies_to ?? [],
    writing,
    visual: { ...(spec.visual ?? {}), palette, typography },
    video: spec.video ?? {},
    references: spec.references ?? [],
    rules,
    logo: { source: kitLogo ?? (dnaLogo ? "dna" : null), dnaUrl: dnaLogo },
    fromDna: {
      colors: Object.keys(dnaPalette).length > 0 && !ownPalette.primary,
      fonts: dnaFonts.length > 0 && !ownType.heading,
      voice: voiceFromDna,
      logo: !kitLogo && !!dnaLogo,
      rules: !!(rules.do || rules.dont),
    },
  };
}

/** A Style applies to a format when it lists it, or lists nothing (= everything). */
export function styleAppliesTo(resolved: ResolvedStyle, format: string): boolean {
  return !resolved.styleId || !resolved.appliesTo.length || resolved.appliesTo.includes(format);
}
