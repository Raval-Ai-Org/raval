// Turn several reference analyses into one suggested Style, and apply a
// suggestion to a spec without ever overwriting a field the user set.
// Pure and browser-safe.
import { normalizeHex, parseStyleSpec } from "./spec";
import type { StyleSpec, VideoStyle, VisualStyle, WritingStyle } from "./spec";

/** What analysing one inspiration / writing sample produced (stored on the asset). */
export type ReferenceAnalysis = {
  kind: "visual" | "writing";
  /** Dominant colours, most prominent first. */
  colors?: string[];
  visual?: Partial<VisualStyle>;
  writing?: Partial<WritingStyle>;
  video?: Partial<VideoStyle>;
  summary?: string;
};

export type Suggestion = {
  spec: StyleSpec;
  /** Field path → share of references that agreed, 0..1. */
  confidence: Record<string, number>;
  sources: number;
};

/** RGB distance, 0..441. */
export function colorDistance(a: string, b: string): number {
  const p = (h: string) => {
    const n = normalizeHex(h).slice(1);
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  };
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function luminance(hex: string): number {
  const n = normalizeHex(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string): number {
  const n = normalizeHex(hex).slice(1);
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const max = Math.max(...c);
  const min = Math.min(...c);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Cluster colours (within `threshold`) weighted by how prominent they were in
 * each reference; return cluster centres, heaviest first.
 */
export function clusterColors(lists: string[][], threshold = 36): string[] {
  const clusters: Array<{ hex: string; weight: number }> = [];
  for (const list of lists) {
    list.slice(0, 8).forEach((raw, idx) => {
      if (!/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw ?? "")) return;
      const hex = normalizeHex(raw);
      const w = 1 / (idx + 1);
      const hit = clusters.find((c) => colorDistance(c.hex, hex) < threshold);
      if (hit) hit.weight += w;
      else clusters.push({ hex, weight: w });
    });
  }
  return clusters.sort((a, b) => b.weight - a.weight).map((c) => c.hex);
}

/** Assign palette roles: darkest/lightest become text/background, the most saturated leads. */
export function rolesFromColors(colors: string[]): NonNullable<VisualStyle["palette"]> {
  if (!colors.length) return {};
  const pool = [...colors];
  const take = (pick: (c: string) => number, ok: (c: string) => boolean) => {
    const candidates = pool.filter(ok);
    if (!candidates.length) return undefined;
    const best = candidates.reduce((a, b) => (pick(b) > pick(a) ? b : a));
    pool.splice(pool.indexOf(best), 1);
    return best;
  };
  const background = take(
    (c) => luminance(c),
    (c) => luminance(c) > 0.85 || luminance(c) < 0.08,
  );
  const text = take(
    (c) => Math.abs(luminance(c) - luminance(background ?? "#ffffff")),
    (c) => saturation(c) < 0.25,
  );
  // Keep prominence order among the chromatic colours.
  const chromatic = pool.filter((c) => saturation(c) >= 0.2);
  const rest = pool.filter((c) => !chromatic.includes(c));
  const ordered = [...chromatic, ...rest];
  return {
    primary: ordered[0],
    secondary: ordered[1],
    accent: ordered[2],
    background,
    text,
    extra: ordered.slice(3, 6).length ? ordered.slice(3, 6) : undefined,
  };
}

function mode<T>(values: T[]): { value: T; share: number } | null {
  if (!values.length) return null;
  const counts = new Map<string, { value: T; n: number }>();
  for (const v of values) {
    const k = JSON.stringify(v);
    const hit = counts.get(k);
    if (hit) hit.n++;
    else counts.set(k, { value: v, n: 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return { value: best.value, share: best.n / values.length };
}

function avg(values: number[]): number | undefined {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : undefined;
}

function unionList(lists: Array<string[] | undefined>, max: number): string[] | undefined {
  const seen = new Map<string, string>();
  for (const l of lists)
    for (const v of l ?? []) {
      const k = v.trim().toLowerCase();
      if (k && !seen.has(k)) seen.set(k, v.trim());
    }
  const out = [...seen.values()].slice(0, max);
  return out.length ? out : undefined;
}

function longestText(values: Array<string | undefined>): string | undefined {
  const v = values.filter((x): x is string => !!x?.trim());
  if (!v.length) return undefined;
  // Pick the most common; fall back to the most detailed description.
  const m = mode(v.map((s) => s.trim()));
  if (m && m.share > 0.5) return m.value;
  return v.sort((a, b) => b.length - a.length)[0];
}

export function mergeAnalyses(analyses: ReferenceAnalysis[]): Suggestion {
  const confidence: Record<string, number> = {};
  const visuals = analyses.filter((a) => a.kind === "visual");
  const writings = analyses.filter((a) => a.kind === "writing");
  const spec: StyleSpec = {};

  if (visuals.length) {
    const v: VisualStyle = {};
    const colors = clusterColors(visuals.map((a) => a.colors ?? []));
    if (colors.length) {
      v.palette = rolesFromColors(colors);
      confidence["visual.palette"] = Math.min(
        1,
        colors.length ? visuals.filter((a) => a.colors?.length).length / visuals.length : 0,
      );
    }
    const enumField = <K extends keyof VisualStyle>(key: K) => {
      const m = mode(
        visuals.map((a) => a.visual?.[key]).filter((x) => x != null) as VisualStyle[K][],
      );
      if (m) {
        v[key] = m.value;
        confidence[`visual.${String(key)}`] = m.share;
      }
    };
    enumField("medium");
    enumField("textPlacement");
    enumField("whitespace");
    for (const key of ["mood", "lighting", "grading", "texture", "composition", "notes"] as const) {
      const t = longestText(visuals.map((a) => a.visual?.[key]));
      if (t) {
        v[key] = t;
        confidence[`visual.${key}`] =
          visuals.filter((a) => a.visual?.[key]).length / visuals.length;
      }
    }
    const heading = mode(
      visuals.map((a) => a.visual?.typography?.heading).filter(Boolean) as string[],
    );
    const body = mode(visuals.map((a) => a.visual?.typography?.body).filter(Boolean) as string[]);
    const casing = mode(
      visuals.map((a) => a.visual?.typography?.casing).filter(Boolean) as string[],
    );
    if (heading || body) {
      v.typography = {
        heading: heading?.value,
        body: body?.value,
        casing: casing?.value as NonNullable<VisualStyle["typography"]>["casing"],
      };
      confidence["visual.typography"] = heading?.share ?? body?.share ?? 0;
    }
    const elements = unionList(
      visuals.map((a) => a.visual?.elements),
      8,
    );
    if (elements) v.elements = elements;
    const avoid = unionList(
      visuals.map((a) => a.visual?.avoid),
      12,
    );
    if (avoid) v.avoid = avoid;
    const words = avg(
      visuals.map((a) => a.visual?.textOnImage?.maxWords).filter((n): n is number => n != null),
    );
    const textStyle = longestText(visuals.map((a) => a.visual?.textOnImage?.style));
    if (words != null || textStyle) v.textOnImage = { maxWords: words, style: textStyle };
    const corner = mode(visuals.map((a) => a.visual?.logo?.corner).filter(Boolean) as string[]);
    if (corner)
      v.logo = { use: true, corner: corner.value as NonNullable<VisualStyle["logo"]>["corner"] };
    spec.visual = v;

    const videos = visuals.filter((a) => a.video && Object.keys(a.video).length);
    if (videos.length) {
      const vid: VideoStyle = {};
      const pacing = mode(
        videos.map((a) => a.video?.pacing).filter(Boolean) as VideoStyle["pacing"][],
      );
      if (pacing) vid.pacing = pacing.value;
      for (const key of [
        "shots",
        "transitions",
        "hook",
        "music",
        "intro",
        "outro",
        "notes",
      ] as const) {
        const t = longestText(videos.map((a) => a.video?.[key]));
        if (t) vid[key] = t;
      }
      const cap = videos.map((a) => a.video?.captions).find(Boolean);
      if (cap) vid.captions = cap;
      spec.video = vid;
    }
  }

  if (writings.length) {
    const w: WritingStyle = {};
    const voice = longestText(writings.map((a) => a.writing?.voice));
    if (voice) w.voice = voice;
    const tones = writings.map((a) => a.writing?.tone).filter(Boolean) as NonNullable<
      WritingStyle["tone"]
    >[];
    if (tones.length) {
      w.tone = {
        casual: avg(tones.map((t) => t.casual).filter((n): n is number => n != null)),
        playful: avg(tones.map((t) => t.playful).filter((n): n is number => n != null)),
        detailed: avg(tones.map((t) => t.detailed).filter((n): n is number => n != null)),
        bold: avg(tones.map((t) => t.bold).filter((n): n is number => n != null)),
      };
      confidence["writing.tone"] = tones.length / writings.length;
    }
    for (const key of ["sentenceLength", "readingLevel", "casing", "person", "emoji"] as const) {
      const m = mode(writings.map((a) => a.writing?.[key]).filter(Boolean) as string[]);
      if (m) {
        (w as Record<string, unknown>)[key] = m.value;
        confidence[`writing.${key}`] = m.share;
      }
    }
    const counts = writings
      .map((a) => a.writing?.hashtags?.count)
      .filter((n): n is number => n != null);
    const always = unionList(
      writings.map((a) => a.writing?.hashtags?.always),
      6,
    );
    if (counts.length || always) w.hashtags = { count: avg(counts), always };
    w.favoriteEmoji = unionList(
      writings.map((a) => a.writing?.favoriteEmoji),
      8,
    );
    w.hooks = unionList(
      writings.map((a) => a.writing?.hooks),
      6,
    );
    w.signaturePhrases = unionList(
      writings.map((a) => a.writing?.signaturePhrases),
      8,
    );
    w.bannedWords = unionList(
      writings.map((a) => a.writing?.bannedWords),
      30,
    );
    w.examples = unionList(
      writings.map((a) => a.writing?.examples),
      3,
    );
    const cta = longestText(writings.map((a) => a.writing?.cta));
    if (cta) w.cta = cta;
    const lb = mode(
      writings.map((a) => a.writing?.formatting?.lineBreaks).filter(Boolean) as string[],
    );
    if (lb) w.formatting = { lineBreaks: lb.value as "dense" | "airy" };
    spec.writing = parseStyleSpec({ writing: w }).writing;
  }

  return { spec: parseStyleSpec(spec), confidence, sources: analyses.length };
}

const USER_FIELD = "user";

/** Flatten a section to its top-level field paths, e.g. "visual.mood". */
function sectionPaths(spec: StyleSpec): string[] {
  const out: string[] = [];
  for (const section of ["writing", "visual", "video"] as const) {
    const s = spec[section];
    if (s) for (const key of Object.keys(s)) out.push(`${section}.${key}`);
  }
  return out;
}

/**
 * Apply `suggestion` onto `current`. Only fields in `only` (default: all) are
 * applied, and never a field whose provenance is "user". Applied fields are
 * marked "analysis".
 */
export function applySuggestion(
  current: StyleSpec,
  suggestion: StyleSpec,
  only?: string[],
): StyleSpec {
  const next = parseStyleSpec(current);
  const prov = { ...(next.provenance ?? {}) };
  const allowed = new Set(only ?? sectionPaths(suggestion));
  for (const path of sectionPaths(suggestion)) {
    if (!allowed.has(path) || prov[path] === USER_FIELD) continue;
    const [section, key] = path.split(".") as ["writing" | "visual" | "video", string];
    const value = (suggestion[section] as Record<string, unknown>)[key];
    if (value === undefined) continue;
    next[section] = { ...(next[section] ?? {}), [key]: value } as never;
    prov[path] = "analysis";
  }
  if (suggestion.references?.length) {
    const have = new Set((next.references ?? []).map((r) => r.assetId));
    next.references = [
      ...(next.references ?? []),
      ...suggestion.references.filter((r) => !have.has(r.assetId)),
    ].slice(0, 12);
  }
  next.provenance = prov;
  return parseStyleSpec(next);
}

/** Mark the given paths as user-set (called when a person edits a field). */
export function markUserEdited(spec: StyleSpec, paths: string[]): StyleSpec {
  const prov = { ...(spec.provenance ?? {}) };
  for (const p of paths) prov[p] = USER_FIELD;
  return { ...spec, provenance: prov };
}
