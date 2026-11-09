// "I don't have a website" (onboarding): the brand kit a person builds by
// hand instead of a scan. Pure and browser-safe. ManualBrandStep only renders
// what this decides; OnboardingPage saves `manualDnaFields` into Brand DNA.
//
// Only the brand's name and one line are needed; everything else is optional
// and what is left empty is listed in `missing`, so Brain can ask for it later.
// Nothing here estimates or invents a value: every field is the person's words.

export type Sells = "products" | "services" | "both";

export type ManualCompetitor = { name: string; url: string };

export type ManualBrand = {
  brandName: string;
  oneLiner: string;
  /** A longer "about us", optional. */
  about: string;
  /** The category's label (one of CATEGORIES, or typed). */
  industry: string;
  sells: Sells;
  /** Who it's for, in the person's words. */
  audience: string;
  /** Tone ids from VOICES. */
  voice: string[];
  /** Hex colours, most important first. */
  colors: string[];
  /** The uploaded logo, re-encoded in the browser as a small PNG data URL. */
  logo: string | null;
  competitors: ManualCompetitor[];
};

export const emptyManualBrand: ManualBrand = {
  brandName: "",
  oneLiner: "",
  about: "",
  industry: "",
  sells: "products",
  audience: "",
  voice: [],
  colors: [],
  logo: null,
  competitors: [],
};

export const LIMITS = {
  brandName: 100,
  oneLiner: 200,
  about: 1200,
  industry: 80,
  audience: 400,
  colors: 6,
  voice: 3,
  competitors: 6,
  competitorName: 100,
  competitorUrl: 300,
  /** A stored logo (data URL) larger than this is refused. */
  logoChars: 400_000,
} as const;

/** The parts of the kit, in the order they are asked. */
export const MANUAL_PARTS = ["basics", "category", "look", "inspiration", "competitors"] as const;
export type ManualPart = (typeof MANUAL_PARTS)[number];

export const PART_LABELS: Record<ManualPart, string> = {
  basics: "Basics",
  category: "Category",
  look: "Look",
  inspiration: "Inspiration",
  competitors: "Competitors",
};

export const CATEGORIES = [
  { id: "food", label: "Food & drink" },
  { id: "fashion", label: "Fashion & apparel" },
  { id: "beauty", label: "Beauty & wellness" },
  { id: "fitness", label: "Fitness & sport" },
  { id: "health", label: "Health & care" },
  { id: "home", label: "Home & interiors" },
  { id: "tech", label: "Software & tech" },
  { id: "education", label: "Education & coaching" },
  { id: "creative", label: "Creative & design" },
  { id: "services", label: "Professional services" },
  { id: "local", label: "Local business" },
  { id: "travel", label: "Travel & hospitality" },
  { id: "pets", label: "Pets" },
  { id: "kids", label: "Kids & family" },
  { id: "jewellery", label: "Jewellery & gifts" },
  { id: "auto", label: "Auto & transport" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const categoryFor = (industry: string) =>
  CATEGORIES.find((c) => c.label.toLowerCase() === industry.trim().toLowerCase()) ?? null;

export const VOICES = [
  { id: "friendly", label: "Friendly", line: "warm and approachable" },
  { id: "bold", label: "Bold", line: "confident and direct" },
  { id: "playful", label: "Playful", line: "light, witty and fun" },
  { id: "expert", label: "Expert", line: "knowledgeable and precise" },
  { id: "calm", label: "Calm", line: "calm and reassuring" },
  { id: "premium", label: "Premium", line: "refined and understated" },
] as const;
export type VoiceId = (typeof VOICES)[number]["id"];

/** Ready-made palettes for a brand with no colours yet (primary first). */
export const PALETTES = [
  { id: "moss", label: "Fresh", colors: ["#1F3B2D", "#C8F169", "#F4F1EA"] },
  { id: "ocean", label: "Ocean", colors: ["#0B3D91", "#3FA9F5", "#EAF4FF"] },
  { id: "sunset", label: "Sunset", colors: ["#E8553D", "#F7B32B", "#FFF4E6"] },
  { id: "berry", label: "Berry", colors: ["#6D214F", "#E84393", "#FDEFF6"] },
  { id: "earth", label: "Earth", colors: ["#7A4E2D", "#D9A066", "#F6EFE6"] },
  { id: "mono", label: "Mono", colors: ["#111111", "#6B6B6B", "#F5F5F5"] },
  { id: "violet", label: "Violet", colors: ["#3D2C8D", "#916BBF", "#F1EDFB"] },
  { id: "citrus", label: "Citrus", colors: ["#0F7B6C", "#FFC93C", "#FFFBEA"] },
] as const;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc", "ABCDEF" → "#AABBCC"; anything else → null. */
export function normalizeHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const raw = match[1];
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return `#${full.toUpperCase()}`;
}

/** Adds a colour once, keeping the order; never more than LIMITS.colors. */
export function addColor(colors: string[], value: string): string[] {
  const hex = normalizeHex(value);
  if (!hex || colors.includes(hex)) return colors;
  return [...colors, hex].slice(0, LIMITS.colors);
}

export function removeColor(colors: string[], hex: string): string[] {
  return colors.filter((c) => c !== hex);
}

/** Moves a colour to the front (the primary). */
export function makePrimary(colors: string[], hex: string): string[] {
  return colors.includes(hex) ? [hex, ...colors.filter((c) => c !== hex)] : colors;
}

export const COLOR_ROLES = ["Primary", "Secondary", "Accent"] as const;
export const colorRole = (index: number) => COLOR_ROLES[index] ?? `Colour ${index + 1}`;

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const distance = (a: [number, number, number], b: [number, number, number]) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** Relative luminance 0–1. */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink that reads on a swatch of this colour. */
export const inkOn = (hex: string) => (luminance(hex) > 0.45 ? "#111111" : "#FFFFFF");

/**
 * The logo's own colours from its RGBA pixels: transparent pixels are ignored,
 * near-white and near-black only count when there is little else, and colours
 * closer than a visible step are merged. Most used first, at most `max`.
 */
export function paletteFromPixels(data: ArrayLike<number>, max = 4): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const all = [...buckets.values()]
    .map((b) => ({ n: b.n, rgb: [b.r / b.n, b.g / b.n, b.b / b.n] as [number, number, number] }))
    .sort((a, b) => b.n - a.n);
  const total = all.reduce((sum, b) => sum + b.n, 0);
  if (!total) return [];
  const neutral = ([r, g, b]: [number, number, number]) => {
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    return (hi > 240 && lo > 225) || hi < 22;
  };
  const picked: { rgb: [number, number, number]; n: number }[] = [];
  const pick = (allowNeutral: boolean) => {
    for (const bucket of all) {
      if (picked.length >= max) return;
      if (bucket.n / total < 0.004) continue;
      if (!allowNeutral && neutral(bucket.rgb)) continue;
      if (picked.some((p) => distance(p.rgb, bucket.rgb) < 48)) continue;
      picked.push(bucket);
    }
  };
  pick(false);
  if (picked.length < 2) pick(true);
  return picked.map((p) => toHex(...p.rgb));
}

/** "acme.com", "https://acme.com/" → "https://acme.com"; not a web address → "". */
export function normalizeSiteUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return "";
    if (/\s/.test(raw)) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Adds a competitor once (by name or site); never more than LIMITS.competitors. */
export function addCompetitor(
  list: ManualCompetitor[],
  input: { name: string; url: string },
): { list: ManualCompetitor[]; error: string | null } {
  const url = input.url.trim() ? normalizeSiteUrl(input.url) : "";
  if (input.url.trim() && !url) return { list, error: "That doesn't look like a web address." };
  const host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  const name = (input.name.trim() || host).slice(0, LIMITS.competitorName);
  if (!name) return { list, error: "Add a name or a website." };
  if (list.length >= LIMITS.competitors)
    return { list, error: `Up to ${LIMITS.competitors} for now. You can add more later.` };
  const same = list.some(
    (c) =>
      c.name.toLowerCase() === name.toLowerCase() ||
      (url && c.url && new URL(c.url).hostname.replace(/^www\./, "") === host),
  );
  if (same) return { list, error: "Already on your list." };
  return { list: [...list, { name, url: url.slice(0, LIMITS.competitorUrl) }], error: null };
}

/** What Continue needs on the basics: a name and one real line. */
export function basicsIssue(m: ManualBrand): string | null {
  if (m.brandName.trim().length < 2) return "Add your brand's name.";
  if (m.oneLiner.trim().length < 6) return "Say what you do in one line.";
  return null;
}

/** Which optional parts of the kit have something in them (inspiration counted by the caller). */
export function filledParts(m: ManualBrand, inspirations = 0): Record<ManualPart, boolean> {
  return {
    basics: basicsIssue(m) === null,
    category: Boolean(m.industry.trim() || m.audience.trim() || m.about.trim()),
    look: Boolean(m.logo || m.colors.length || m.voice.length),
    inspiration: inspirations > 0,
    competitors: m.competitors.length > 0,
  };
}

/** 0–100: how complete the kit is, for the live preview's meter. */
export function kitScore(m: ManualBrand, inspirations = 0): number {
  const checks = [
    m.brandName.trim().length >= 2,
    m.oneLiner.trim().length >= 6,
    Boolean(m.industry.trim()),
    Boolean(m.audience.trim()),
    Boolean(m.about.trim()),
    Boolean(m.logo),
    m.colors.length > 0,
    m.voice.length > 0,
    inspirations > 0,
    m.competitors.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

const businessModel = (sells: Sells) =>
  sells === "services" ? "Services" : sells === "both" ? "Products and services" : "Products";

const voiceLine = (ids: string[]) => {
  const lines: string[] = [];
  for (const id of ids) {
    const line = VOICES.find((v) => v.id === id)?.line;
    if (line) lines.push(line);
  }
  if (!lines.length) return "";
  const text =
    lines.length > 1 ? `${lines.slice(0, -1).join(", ")} and ${lines[lines.length - 1]}` : lines[0];
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
};

const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;

/** A logo the browser made, or null if it isn't one we can keep. */
export function keepableLogo(logo: string | null): string | null {
  if (!logo || logo.length > LIMITS.logoChars || !LOGO_DATA_URL.test(logo)) return null;
  return logo;
}

const MANUAL_SOURCE = { label: "Added by you during setup" };

/**
 * The Brand DNA fields this kit fills. Empty answers stay empty (never a
 * guess) and are listed in `missing`, so Brain asks for them later.
 */
export function manualDnaFields(m: ManualBrand) {
  const clip = (value: string, max: number) => value.trim().slice(0, max);
  const fields = {
    brandName: clip(m.brandName, LIMITS.brandName),
    oneLiner: clip(m.oneLiner, LIMITS.oneLiner),
    about: clip(m.about, LIMITS.about),
    industry: clip(m.industry, LIMITS.industry),
    businessModel: businessModel(m.sells),
    audience: clip(m.audience, LIMITS.audience),
    voice: voiceLine(m.voice),
  };
  const colors = m.colors
    .map((c) => normalizeHex(c))
    .filter((c): c is string => Boolean(c))
    .slice(0, LIMITS.colors)
    .map((hex, i) => ({ name: colorRole(i), hex }));
  const logoUrl = keepableLogo(m.logo);
  const competitors = m.competitors.slice(0, LIMITS.competitors).map((c, i) => ({
    id: `manual-${i + 1}`,
    name: clip(c.name, LIMITS.competitorName),
    ...(c.url ? { url: c.url } : {}),
    notes: "Added during setup",
  }));
  const missing = [
    !fields.industry && "industry",
    !fields.audience && "audience",
    !fields.about && "about",
    !fields.voice && "voice",
    !colors.length && "colors",
    !logoUrl && "logo",
    !competitors.length && "competitors",
  ].filter((key): key is string => Boolean(key));
  const sources = Object.fromEntries(
    [
      ...Object.entries(fields)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key),
      ...(colors.length ? ["colors"] : []),
      ...(logoUrl ? ["logo"] : []),
    ].map((key) => [key, MANUAL_SOURCE]),
  );
  return { ...fields, colors, logoUrl, competitors, missing, sources };
}

/** A saved draft from storage, cleaned; anything unreadable is dropped. */
export function readManualDraft(raw: unknown): ManualBrand | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const sells: Sells =
    r.sells === "services" || r.sells === "both" || r.sells === "products" ? r.sells : "products";
  const draft: ManualBrand = {
    brandName: str(r.brandName, LIMITS.brandName),
    oneLiner: str(r.oneLiner, LIMITS.oneLiner),
    about: str(r.about, LIMITS.about),
    industry: str(r.industry, LIMITS.industry),
    sells,
    audience: str(r.audience, LIMITS.audience),
    voice: Array.isArray(r.voice)
      ? r.voice.filter((v): v is string => VOICES.some((x) => x.id === v)).slice(0, LIMITS.voice)
      : [],
    colors: Array.isArray(r.colors)
      ? r.colors.reduce<string[]>((acc, c) => (typeof c === "string" ? addColor(acc, c) : acc), [])
      : [],
    logo: keepableLogo(typeof r.logo === "string" ? r.logo : null),
    competitors: Array.isArray(r.competitors)
      ? r.competitors.reduce<ManualCompetitor[]>((acc, c) => {
          if (!c || typeof c !== "object") return acc;
          const entry = c as Record<string, unknown>;
          return addCompetitor(acc, {
            name: str(entry.name, LIMITS.competitorName),
            url: str(entry.url, LIMITS.competitorUrl),
          }).list;
        }, [])
      : [],
  };
  return draft.brandName || draft.oneLiner ? draft : null;
}
