// Shared primitives for generating post images.
// Used by:
//   • StudioCanvasModal (draft/review composer)
//   • GeneratePostImageButton (approval cards, recent posts, anywhere a
//     post body + brand DNA is available)
//
// Design goals:
//   • ONE image per (postId, size) — cached in sessionStorage so switching
//     platforms, opening the modal, or coming back to the rail never re-bills.
//   • Prompt is deeply personalized from Brand DNA + the post's hook line.
//   • Stable "style seed" per post keeps every aspect ratio visually consistent
//     so square / landscape / portrait feel like one campaign.

import type { PlatformId } from "@/lib/social-platforms";
import { PLATFORMS } from "@/lib/social-platforms";

export type ImgSize = "1024x1024" | "1792x1024" | "1024x1792";

/** Instagram-first default. Every post image starts at 1:1 unless the user
 *  explicitly opts into a platform-optimal size via autoSize=true. */
export const DEFAULT_IMG_SIZE: ImgSize = "1024x1024";

export const SIZE_LABEL: Record<ImgSize, string> = {
  "1024x1024": "Instagram · Square 1:1",
  "1792x1024": "Landscape 16:9",
  "1024x1792": "Story / Reel 9:16",
};

export const OPTIMAL_SIZE_BY_PLATFORM: Record<PlatformId, ImgSize> = {
  linkedin: "1792x1024",
  twitter: "1792x1024",
  facebook: "1792x1024",
  instagram: "1024x1024",
  threads: "1024x1024",
  tiktok: "1024x1792",
  youtube: "1792x1024",
};

export const sizeForPlatform = (p?: PlatformId | null): ImgSize =>
  (p && OPTIMAL_SIZE_BY_PLATFORM[p]) || DEFAULT_IMG_SIZE;


export type BrandColorLite = { name?: string; hex: string };

export type BrandDnaLite = {
  brandName?: string;
  oneLiner?: string;
  about?: string;
  voice?: string;
  audience?: string;
  values?: string;
  products?: string;
  doRules?: string;
  dontRules?: string;
  websiteUrl?: string | null;
  industry?: string;
  businessModel?: string;
  mission?: string;
  vision?: string;
  positioning?: string;
  uniqueValueProp?: string;
  keywords?: string[];
  audienceTags?: string[];
  valueTags?: string[];
  colors?: BrandColorLite[];
  fonts?: string[];
  logoUrl?: string | null;
  faviconUrl?: string | null;
};

export function loadBrandDna(workspaceId?: string | null): BrandDnaLite | null {
  if (!workspaceId || typeof window === "undefined") return null;
  const keys = [`brand-dna:v3:${workspaceId}`, `brand-dna:v2:${workspaceId}`, `brand-dna:${workspaceId}`];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) return JSON.parse(raw) as BrandDnaLite;
    } catch {}
  }
  return null;
}


/* ---------------- Shared visual system ---------------- */

export type VisualPalette = {
  id: string;
  label: string;
  promptDescription: string;
  bg: string;        // background hex
  surface: string;   // card surface hex
  fg: string;        // primary text hex
  muted: string;     // muted text hex
  accent: string;    // brand accent hex
};

const PALETTES: VisualPalette[] = [
  { id: "cool-editorial", label: "Cool editorial", promptDescription: "cool editorial palette — deep slate, off-white, and one warm coral accent",
    bg: "#0F172A", surface: "#F8FAFC", fg: "#0B1220", muted: "#475569", accent: "#F97066" },
  { id: "warm-neutral",   label: "Warm neutral",   promptDescription: "warm neutral palette — sand, cream, espresso, with a single vivid accent",
    bg: "#F5EFE6", surface: "#FFFDF8", fg: "#2A1E12", muted: "#7A6A55", accent: "#C2410C" },
  { id: "mono-contrast",  label: "Mono contrast",  promptDescription: "high-contrast monochrome — near-black on bone-white with one saturated accent",
    bg: "#0A0A0A", surface: "#FAFAF7", fg: "#0A0A0A", muted: "#525252", accent: "#22C55E" },
  { id: "soft-gradient",  label: "Soft modern",    promptDescription: "soft modern gradient — pastel-to-neutral wash with crisp black type",
    bg: "#EEF2FF", surface: "#FFFFFF", fg: "#111827", muted: "#6B7280", accent: "#6366F1" },
  { id: "premium-dark",   label: "Premium dark",   promptDescription: "premium dark palette — midnight navy background with luminous highlights and a mint accent",
    bg: "#0B1220", surface: "#111827", fg: "#F8FAFC", muted: "#94A3B8", accent: "#5EEAD4" },
  { id: "brand-forward",  label: "Brand-forward",  promptDescription: "clean brand-forward palette — off-white base, charcoal type, one confident accent",
    bg: "#FAFAF9", surface: "#FFFFFF", fg: "#18181B", muted: "#71717A", accent: "#2563EB" },
];

const COMPOSITIONS = [
  "off-center subject, generous negative space, editorial poise",
  "centered hero subject, symmetric framing, magazine cover energy",
  "rule-of-thirds layout with layered depth and one focal element",
  "flat editorial grid, single strong focal point, deliberate whitespace",
  "asymmetric split — visual on one side, breathing room on the other",
];

const TYPOGRAPHIES = [
  { promptDescription: "modern grotesque sans-serif, tight tracking, confident hierarchy",
    fontFamily: `"Inter", "Helvetica Neue", system-ui, sans-serif`, weight: 700, tracking: "-0.02em" },
  { promptDescription: "clean geometric sans-serif, generous leading, editorial restraint",
    fontFamily: `"Space Grotesk", "Inter", system-ui, sans-serif`, weight: 600, tracking: "-0.01em" },
  { promptDescription: "premium serif display + minimal sans support, magazine feel",
    fontFamily: `"Fraunces", "Playfair Display", Georgia, serif`, weight: 600, tracking: "-0.015em" },
];

export type BrandVisualSystem = {
  palette: VisualPalette;
  composition: string;
  typography: typeof TYPOGRAPHIES[number];
};

/**
 * Deterministic 32-bit FNV-1a hash. Same input → same output, in any
 * runtime (Node, edge, browser). Used to pick a stable palette / composition
 * / typography per post so every regeneration and every aspect ratio for the
 * same post lands on the same visual identity.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Short human-readable seed token derived from (brand, post). Included in
 * the prompt as an explicit "style anchor" so the model has a repeatable
 * handle across regenerations of the same post.
 */
export function getStyleSeed(brand: BrandDnaLite | null, seedKey: string, workspaceName?: string | null): string {
  const brandName = (brand?.brandName || workspaceName || "brand").trim().toLowerCase();
  // Intentionally exclude mutable brand fields (voice/industry/values) from
  // the seed basis — editing Brand DNA must never change a post's visual
  // identity once it exists. Only (brand identity + post id) drives it.
  const h = fnv1a(`${brandName}::${seedKey}`);
  return `sty-${h.toString(36).padStart(7, "0").slice(0, 7)}`;
}

/** Normalize a hex like "#abc" → "#aabbcc". Returns null for invalid input. */
function normalizeHex(input?: string | null): string | null {
  if (!input) return null;
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) return "#" + s.split("").map((c) => c + c).join("").toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return "#" + s.toLowerCase();
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pickTextOn(bg: string): string {
  return relLuminance(bg) > 0.55 ? "#0A0A0A" : "#FAFAF7";
}

/** Build a palette from the user's real brand colors when available.
 *  Falls back to the deterministic seeded palette otherwise. */
function paletteFromBrand(brand: BrandDnaLite | null, fallback: VisualPalette): VisualPalette | null {
  const raw = (brand?.colors ?? []).map((c) => ({ name: c?.name, hex: normalizeHex(c?.hex) })).filter((c) => c.hex) as { name?: string; hex: string }[];
  if (raw.length === 0) return null;

  // Sort by luminance to identify surface / bg / accent slots.
  const sorted = [...raw].sort((a, b) => relLuminance(b.hex) - relLuminance(a.hex));
  const lightest = sorted[0].hex;
  const darkest = sorted[sorted.length - 1].hex;
  // Accent = the most saturated color (max range between channels).
  const accent = raw.reduce<{ hex: string; range: number }>((best, c) => {
    const [r, g, b] = hexToRgb(c.hex);
    const range = Math.max(r, g, b) - Math.min(r, g, b);
    return range > best.range ? { hex: c.hex, range } : best;
  }, { hex: raw[0].hex, range: -1 }).hex;


  // Prefer light surface + dark ink; if brand is dark-first, invert.
  const brandIsDark = relLuminance(lightest) < 0.45;
  const bg = brandIsDark ? darkest : lightest;
  const surface = brandIsDark ? "#FFFFFF" : lightest;
  const fg = pickTextOn(surface);
  const muted = brandIsDark ? "#94A3B8" : "#525252";

  const named = raw.slice(0, 5).map((c) => `${c.name ? c.name + " " : ""}${c.hex}`).join(", ");

  return {
    id: "brand-real",
    label: "Brand palette",
    promptDescription: `EXACT brand palette (use these hex values verbatim, do not invent new colors): ${named}. Accent color: ${accent}.`,
    bg, surface, fg, muted, accent,
  };
}

function typographyFromBrand(brand: BrandDnaLite | null, fallback: typeof TYPOGRAPHIES[number]): typeof TYPOGRAPHIES[number] | null {
  const fonts = (brand?.fonts ?? []).map((f) => (f || "").trim()).filter(Boolean);
  if (fonts.length === 0) return null;
  const primary = fonts[0];
  const secondary = fonts[1];
  return {
    promptDescription: `EXACT brand typography — headline set in "${primary}"${secondary ? `, body/support set in "${secondary}"` : ""}. Match the weight, tracking, and rhythm of the real brand type system.`,
    fontFamily: `"${primary}", ${secondary ? `"${secondary}", ` : ""}system-ui, sans-serif`,
    weight: 700,
    tracking: "-0.015em",
  };
}

export function getBrandVisualSystem(
  brand: BrandDnaLite | null,
  seedKey: string,
  workspaceName?: string | null,
): BrandVisualSystem & { paletteSource: "brand" | "seeded"; typographySource: "brand" | "seeded" } {
  const brandName = (brand?.brandName || workspaceName || "brand").trim().toLowerCase() || "brand";
  const h = fnv1a(`${brandName}::${seedKey || "default"}`);
  const paletteIdx = h % PALETTES.length;
  const compIdx = fnv1a(`c:${brandName}::${seedKey || "default"}`) % COMPOSITIONS.length;
  const typoIdx = fnv1a(`t:${brandName}::${seedKey || "default"}`) % TYPOGRAPHIES.length;
  const fallbackPalette = PALETTES[paletteIdx];
  const fallbackTypo = TYPOGRAPHIES[typoIdx];
  const brandPalette = paletteFromBrand(brand, fallbackPalette);
  const brandTypo = typographyFromBrand(brand, fallbackTypo);
  return {
    palette: brandPalette ?? fallbackPalette,
    composition: COMPOSITIONS[compIdx],
    typography: brandTypo ?? fallbackTypo,
    paletteSource: brandPalette ? "brand" : "seeded",
    typographySource: brandTypo ? "brand" : "seeded",
  };
}




/* ---------------- Voice → visual mood mapping ---------------- */

/** Derive an explicit visual mood + Recraft-style hint from brand voice keywords.
 *  This turns fuzzy "brand voice" text into concrete art direction the model
 *  can actually execute on. */
export function deriveMoodFromVoice(
  voice?: string | null,
  values?: string | null,
  industry?: string | null,
): string {
  const text = `${voice ?? ""} ${values ?? ""} ${industry ?? ""}`.toLowerCase();
  const moods: string[] = [];
  const has = (...kw: string[]) => kw.some((k) => text.includes(k));

  if (has("playful", "fun", "friendly", "quirky", "bold")) moods.push("energetic, expressive, high-saturation accents, dynamic composition");
  if (has("premium", "luxury", "elegant", "sophisticated", "refined")) moods.push("understated luxury, editorial restraint, generous whitespace, museum-grade craft");
  if (has("technical", "engineer", "developer", "b2b", "enterprise", "saas")) moods.push("precise, systematic, grid-aligned, information-dense but clean");
  if (has("wellness", "calm", "mindful", "gentle", "warm", "human")) moods.push("soft, warm, humanist, natural light, organic shapes");
  if (has("modern", "minimal", "clean", "simple")) moods.push("modernist minimalism, high whitespace ratio, one hero element");
  if (has("creative", "artistic", "design", "studio")) moods.push("art-directed, editorial magazine cover energy, confident negative space");
  if (has("finance", "fintech", "trust", "secure", "reliable")) moods.push("confident, structured, restrained palette, precise geometry");
  if (moods.length === 0) moods.push("modern editorial, premium, confident, feed-native");
  return moods.slice(0, 2).join("; ");
}

/** Map brand character to a Recraft style hint (best-effort, string only —
 *  server passes it through verbatim; unrecognized values fall back cleanly). */
export function deriveRecraftStyle(
  voice?: string | null,
  industry?: string | null,
): "realistic_image" | "digital_illustration" | "vector_illustration" {
  const text = `${voice ?? ""} ${industry ?? ""}`.toLowerCase();
  if (/(photo|realistic|lifestyle|product shot|wellness|food|fashion|travel)/.test(text)) return "realistic_image";
  if (/(tech|saas|b2b|fintech|enterprise|developer|api|platform)/.test(text)) return "vector_illustration";
  return "digital_illustration";
}


/* ---------------- Prompt builder ---------------- */


export type PromptInspection = {
  brandName: string;
  seedKey: string;
  styleSeed: string;

  size: ImgSize;
  platform?: PlatformId | null;
  autoSize?: boolean;
  hook: string;
  snippet: string;
  brandFields: { key: string; label: string; value: string; used: boolean }[];
  visual: {
    palette: VisualPalette;
    composition: string;
    typographyDescription: string;
    typographyFamily: string;
  };
  aspectLine: string;
  platformLine: string;
  prompt: string;
};

/** Corner that use-post-image will composite the logo into. Story format
 *  uses top-left to stay clear of the bottom Reels UI chrome; feed formats
 *  use bottom-right (least-attention zone, keeps the hero visible). */
export function logoCorner(size: ImgSize): "top-left" | "bottom-right" {
  return size === "1024x1792" ? "top-left" : "bottom-right";
}

export function buildImagePromptDetailed(args: {
  postBody: string;
  postTitle?: string | null;
  brand: BrandDnaLite | null;
  workspaceName?: string | null;
  platform?: PlatformId | null;
  size: ImgSize;
  seedKey: string;
  autoSize?: boolean;
}): PromptInspection {
  const { postBody, postTitle, brand, workspaceName, platform, size, seedKey, autoSize } = args;
  const body = (postBody || "").trim();
  const firstLine = body.split(/\n+/).find((l) => l.trim().length > 0)?.trim() ?? postTitle ?? "";
  const hook = firstLine.slice(0, 180);
  const snippet = body.slice(0, 480);

  const brandName = brand?.brandName || workspaceName || "the brand";
  const industry = brand?.industry?.slice(0, 80);
  const oneLiner = brand?.oneLiner?.slice(0, 160);
  const about = brand?.about?.slice(0, 260);
  const offer = brand?.products?.slice(0, 160);
  const audience = brand?.audience?.slice(0, 160);
  const voice = brand?.voice?.slice(0, 160);
  const values = brand?.values?.slice(0, 160);
  const doRules = brand?.doRules?.slice(0, 200);
  const dontRules = brand?.dontRules?.slice(0, 200);
  const mission = brand?.mission?.slice(0, 200);
  const positioning = brand?.positioning?.slice(0, 200);
  const uvp = brand?.uniqueValueProp?.slice(0, 200);
  const model = brand?.businessModel?.slice(0, 120);
  const audienceTags = (brand?.audienceTags ?? []).filter(Boolean).slice(0, 6).join(", ");
  const valueTags = (brand?.valueTags ?? []).filter(Boolean).slice(0, 6).join(", ");
  const keywords = (brand?.keywords ?? []).filter(Boolean).slice(0, 8).join(", ");
  const brandColors = (brand?.colors ?? []).map((c) => normalizeHex(c?.hex)).filter(Boolean).slice(0, 6) as string[];
  const brandFonts = (brand?.fonts ?? []).filter(Boolean).slice(0, 3);
  const hasLogo = !!brand?.logoUrl;

  const brandFields: PromptInspection["brandFields"] = [
    { key: "brandName",   label: "Brand name",    value: brandName,             used: !!brandName },
    { key: "industry",    label: "Industry",      value: industry ?? "",        used: !!industry },
    { key: "oneLiner",    label: "Positioning",   value: oneLiner ?? "",        used: !!oneLiner },
    { key: "uvp",         label: "UVP",           value: uvp ?? "",             used: !!uvp },
    { key: "mission",     label: "Mission",       value: mission ?? "",         used: !!mission },
    { key: "products",    label: "Offer",         value: offer ?? "",           used: !!offer },
    { key: "audience",    label: "Audience",      value: audience ?? "",        used: !!audience },
    { key: "audienceTags",label: "Audience tags", value: audienceTags,          used: !!audienceTags },
    { key: "voice",       label: "Voice",         value: voice ?? "",           used: !!voice },
    { key: "values",      label: "Values",        value: values ?? "",          used: !!values },
    { key: "valueTags",   label: "Value tags",    value: valueTags,             used: !!valueTags },
    { key: "keywords",    label: "Keywords",      value: keywords,              used: !!keywords },
    { key: "doRules",     label: "Brand do's",    value: doRules ?? "",         used: !!doRules },
    { key: "dontRules",   label: "Brand don'ts",  value: dontRules ?? "",       used: !!dontRules },
    { key: "colors",      label: "Brand colors",  value: brandColors.join(", "), used: brandColors.length > 0 },
    { key: "fonts",       label: "Brand fonts",   value: brandFonts.join(", "), used: brandFonts.length > 0 },
    { key: "logoUrl",     label: "Logo",          value: hasLogo ? "provided" : "", used: hasLogo },
  ];

  const vis = getBrandVisualSystem(brand, seedKey, workspaceName);
  const styleSeed = getStyleSeed(brand, seedKey, workspaceName);
  const moodLine = deriveMoodFromVoice(voice, values, industry);



  // Instagram-aware crop-safe zones. Instagram re-crops the same asset
  // across surfaces: feed shows 1:1 (or 4:5 portrait), Explore/Profile grid
  // shows 1:1 center-crop, Reels/Stories show 9:16 full-bleed with UI
  // chrome eating the top ~250px and bottom ~350px on 1080×1920. We keep
  // all critical elements (logo, headline, CTA) inside the intersection of
  // these crops so nothing important is ever clipped when the same image is
  // reused across placements.
  const aspectLine =
    size === "1024x1024"
      ? [
          "SQUARE 1:1 (Instagram feed + profile grid native).",
          "SAFE ZONE: keep all logos, headline text, faces, and CTAs inside the CENTER 82% (≈92px inset on every side of a 1024px canvas).",
          "GRID-CROP SAFE: Instagram profile grid center-crops slightly — nothing critical within 40px of any edge.",
          "STORY REUSE: if this same image were re-cropped to 9:16, only the CENTER VERTICAL BAND (≈576px wide, centered) would survive — put the anchor subject inside that band.",
        ].join(" ")
    : size === "1792x1024"
      ? [
          "LANDSCAPE 16:9 (LinkedIn / X / YouTube thumbnail).",
          "SAFE ZONE: keep logo, headline, faces, and CTAs inside the CENTER 88% horizontally (≈108px inset left/right) and CENTER 82% vertically (≈92px inset top/bottom).",
          "SQUARE-CROP SAFE: assume Instagram may center-crop this to 1:1 — put the anchor subject inside the CENTER SQUARE (1024×1024 crop of the 1792 canvas). Nothing critical in the outer left/right 384px bands.",
          "THUMBNAIL LEGIBILITY: headline must remain readable at 320px wide.",
        ].join(" ")
      : [
          "PORTRAIT 9:16 (Instagram Story / Reel / TikTok).",
          "TOP UI CHROME SAFE ZONE: top 14% of the canvas (≈250px on 1024×1792) is reserved for platform UI (profile pill, close button) — no text, logo, or face there.",
          "BOTTOM UI CHROME SAFE ZONE: bottom 20% (≈360px) is reserved for caption, reactions, and CTA sticker — no critical content there.",
          "CORE SAFE ZONE: keep logo, headline, and subject inside the MIDDLE 66% vertically (rows ~250–1430) and CENTER 86% horizontally (≈72px inset).",
          "FEED-CROP SAFE: if re-cropped to 1:1 for the feed, only the CENTER SQUARE (1024×1024, vertically centered) survives — anchor subject must sit inside that square.",
        ].join(" ");

  const platformLine = autoSize && platform
    ? `Optimized for ${PLATFORMS[platform]?.label ?? platform} feed context.`
    : "Instagram-first default sizing — works across every social surface.";

  const cropSafeRule =
    "CROP-SAFE COMPOSITION (non-negotiable): the same asset is reused across 1:1 feed, 9:16 Story, and 16:9 landscape placements. NEVER place logos, wordmarks, headline text, faces, or CTAs against any edge. Treat every edge as a potential crop line. When in doubt, pull critical elements inward toward the CENTER SQUARE of the canvas — that square is the only region guaranteed to survive every crop.";


  const brandDnaHasAny =
    !!(oneLiner || uvp || mission || positioning || about || offer || audience || voice || values || audienceTags || valueTags || keywords || doRules);

  const prompt = [
    `Design ONE premium, on-brand social image for ${brandName}${industry ? ` (${industry})` : ""}.`,
    "",
    brandDnaHasAny
      ? "BRAND DNA — the image must feel unmistakably from this brand. Treat these as authoritative source-of-truth:"
      : "BRAND DNA — no explicit brand profile yet, so infer a tasteful, timeless identity from the post message below. Keep it neutral, editorial, and platform-agnostic:",
    oneLiner && `• Positioning: ${oneLiner}`,
    uvp && `• Unique value prop: ${uvp}`,
    mission && `• Mission: ${mission}`,
    positioning && `• Market position: ${positioning}`,
    about && `• About: ${about}`,
    offer && `• Offer / product: ${offer}`,
    model && `• Business model: ${model}`,
    audience && `• Audience: ${audience}`,
    audienceTags && `• Audience tags: ${audienceTags}`,
    voice && `• Voice & tone: ${voice}`,
    values && `• Core values: ${values}`,
    valueTags && `• Value tags: ${valueTags}`,
    keywords && `• Brand keywords: ${keywords}`,
    doRules && `• Brand do's: ${doRules}`,
    "",
    "POST MESSAGE — the visual must REINFORCE this message, not describe it literally:",
    hook && `• Hook: "${hook}"`,
    `• Draft copy: ${snippet}`,
    "",
    `VISUAL SYSTEM (style anchor: ${styleSeed}) — LOCK these across every size and every regeneration of this post:`,
    brandColors.length > 0
      ? `• EXACT brand palette (use ONLY these hex values, do NOT invent new colors): ${brandColors.join(", ")}. Canvas defaults — bg ${vis.palette.bg}, surface ${vis.palette.surface}, text ${vis.palette.fg}, accent ${vis.palette.accent}.`
      : `• Palette (seeded fallback — no brand colors provided): ${vis.palette.promptDescription} Use bg ${vis.palette.bg}, surface ${vis.palette.surface}, text ${vis.palette.fg}, accent ${vis.palette.accent}.`,
    brandFonts.length > 0
      ? `• EXACT brand fonts (or the closest visual equivalent): ${brandFonts.map((f) => `"${f}"`).join(", ")}. Match weight, tracking, and rhythm.`
      : `• Typography (seeded fallback — no brand fonts provided): ${vis.typography.promptDescription}`,
    `• Composition: ${vis.composition}`,
    `• Visual mood (derived from brand voice): ${moodLine}.`,
    "• Feel: modern, editorial, confident, premium. Feed-native. Scroll-stopping.",
    "• Rendering quality: MAXIMUM. Photographic clarity or crisp vector edges (no fuzzy JPEG artifacts, no blurred textures, no low-poly shading). Every element must look intentional and finished — magazine cover / Apple keynote grade.",
    hasLogo
      ? `• LOGO OVERLAY: the real brand logo will be composited onto this image after generation in the ${logoCorner(size)} corner at ~12% width. LEAVE THAT CORNER CLEAN — no busy pattern, no text, no faces, no high-contrast detail in that ~18% square region. Do NOT draw any logo, wordmark, monogram, or letter mark yourself.`
      : `• No brand logo provided — do NOT invent a logo, wordmark, or monogram. Compose without any brand mark; keep the corner clean.`,
    `• Consistency rule: any other image tagged with style anchor "${styleSeed}" must look like it came from the same art-directed set — same palette, same type system, same compositional grammar. Only reframe for the target aspect ratio.`,
    "• Absolutely NOT: stock-photo, clip-art, AI-generic collage, cliché 3D blobs, generic gradient mesh, purple-pink SaaS gradient, off-palette colors, low-resolution textures.",

    "",
    "TEXT ON IMAGE:",
    "• If any text appears, it must be a short real phrase pulled directly from the post hook (max 6 words). No lorem ipsum, no gibberish, no repeated letters, no misspellings.",
    "• Type must sit in the brand palette. Kerning tight, hierarchy clear. Legible at thumbnail size.",
    "",
    "GUARDRAILS:",
    "• No watermarks. No logos of other companies. No third-party brand marks.",
    "• No real identifiable people unless generic silhouettes/illustrations.",
    "• No unsafe, medical, financial-advice, or regulated-claim imagery.",
    dontRules && `• Brand don'ts: ${dontRules}`,
    "",
    cropSafeRule,
    aspectLine,
    platformLine,
  ].filter(Boolean).join("\n");


  return {
    brandName,
    seedKey,
    styleSeed,

    size,
    platform,
    autoSize,
    hook,
    snippet,
    brandFields,
    visual: {
      palette: vis.palette,
      composition: vis.composition,
      typographyDescription: vis.typography.promptDescription,
      typographyFamily: vis.typography.fontFamily,
    },
    aspectLine,
    platformLine,
    prompt,
  };
}

export function buildImagePrompt(args: Parameters<typeof buildImagePromptDetailed>[0]): string {
  return buildImagePromptDetailed(args).prompt;
}



/* ---------------- Session cache ---------------- */

const CACHE_KEY = "studio:image-cache:v1";
type Cache = Record<string, Partial<Record<ImgSize, string>>>;

function readCache(): Cache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : {};
  } catch { return {}; }
}

function writeCache(next: Cache) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Quota — keep only the most recent 6 posts.
    const ids = Object.keys(next).slice(-6);
    const trimmed: Cache = {};
    for (const id of ids) trimmed[id] = next[id];
    try { window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(trimmed)); } catch {}
  }
}

export function getCachedImage(postId: string | undefined | null, size: ImgSize): string | null {
  if (!postId) return null;
  return readCache()[postId]?.[size] ?? null;
}

export function setCachedImage(postId: string, size: ImgSize, dataUrl: string) {
  const c = readCache();
  c[postId] = { ...(c[postId] || {}), [size]: dataUrl };
  writeCache(c);
  try {
    window.dispatchEvent(new CustomEvent("post-image:cached", { detail: { postId, size } }));
  } catch {}
}

export function hasAnyCachedImage(postId: string | undefined | null): boolean {
  if (!postId) return false;
  const bucket = readCache()[postId];
  return !!bucket && Object.values(bucket).some(Boolean);
}

export function getAnyCachedImage(postId: string | undefined | null): string | null {
  if (!postId) return null;
  const bucket = readCache()[postId];
  if (!bucket) return null;
  // Prefer 1:1 (Instagram default), then landscape, then story.
  return bucket["1024x1024"] ?? bucket["1792x1024"] ?? bucket["1024x1792"] ?? null;
}

export type CachedImageEntry = {
  postId: string;
  size: ImgSize;
  dataUrl: string;
};

export function listAllCachedImages(): CachedImageEntry[] {
  const cache = readCache();
  const out: CachedImageEntry[] = [];
  for (const postId of Object.keys(cache)) {
    const bucket = cache[postId] || {};
    for (const size of Object.keys(bucket) as ImgSize[]) {
      const dataUrl = bucket[size];
      if (dataUrl) out.push({ postId, size, dataUrl });
    }
  }
  return out;
}

export function removeCachedImage(postId: string, size?: ImgSize) {
  const c = readCache();
  if (!c[postId]) return;
  if (size) {
    delete c[postId][size];
    if (Object.keys(c[postId]).length === 0) delete c[postId];
  } else {
    delete c[postId];
  }
  writeCache(c);
  try {
    window.dispatchEvent(new CustomEvent("post-image:cached", { detail: { postId, size, removed: true } }));
  } catch {}
}


