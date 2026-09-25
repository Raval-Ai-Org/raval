// Brand Kit view contracts — what the server returns to the browser. Pure.
import type { ReferenceAnalysis } from "./merge";
import type { KitAssetKind, StyleFormat, StyleSpec } from "./spec";

export type BrandStyleView = {
  id: string;
  name: string;
  description: string | null;
  appliesTo: StyleFormat[];
  isDefault: boolean;
  status: "draft" | "analyzing" | "ready";
  spec: StyleSpec;
  version: number;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export type KitAssetView = {
  id: string;
  styleId: string | null;
  kind: KitAssetKind;
  label: string | null;
  tags: string[];
  /** Signed URL (1 h) for file assets. */
  url: string | null;
  frameUrls: string[];
  textContent: string | null;
  sourceUrl: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  analysisStatus: "none" | "pending" | "running" | "done" | "failed";
  analysisError: string | null;
  analysis: ReferenceAnalysis | null;
  /** Analysis has been "running" too long — offer Retry. */
  stale: boolean;
  createdAt: string;
};

export type BrandKitDnaSummary = {
  hasDna: boolean;
  brandName: string | null;
  voice: string | null;
  colors: Array<{ name?: string; hex: string }>;
  fonts: string[];
  logoUrl: string | null;
};

export type BrandKitOverview = {
  styles: BrandStyleView[];
  assets: KitAssetView[];
  defaultStyleId: string | null;
  dna: BrandKitDnaSummary;
  canEdit: boolean;
};

/** Short list for pickers (Studio, chat, UGC, calendar). */
export type StyleOption = {
  id: string;
  name: string;
  isDefault: boolean;
  appliesTo: StyleFormat[];
  swatches: string[];
  headingFont: string | null;
  bodyFont: string | null;
};

export type UploadTicket = {
  assetId: string;
  path: string;
  token: string;
  /** Extra paths for video frames, same token scheme. */
  frames: Array<{ path: string; token: string }>;
};

export type UploadRule = { mimes: readonly string[]; maxBytes: number; label: string };

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
const MB = 1024 * 1024;

/** Upload limits per kind — checked in the browser for fast feedback and again on the server. */
export const KIT_UPLOAD_RULES: Record<Exclude<KitAssetKind, "writing_sample">, UploadRule> = {
  logo: { mimes: IMAGE_MIMES, maxBytes: 5 * MB, label: "Logo" },
  logo_dark: { mimes: IMAGE_MIMES, maxBytes: 5 * MB, label: "Logo for dark backgrounds" },
  logo_mark: { mimes: IMAGE_MIMES, maxBytes: 5 * MB, label: "Icon" },
  font_file: {
    mimes: [
      "font/woff2",
      "font/woff",
      "font/ttf",
      "font/otf",
      "application/font-woff",
      "application/x-font-ttf",
      "application/x-font-otf",
      "application/octet-stream",
    ],
    maxBytes: 2 * MB,
    label: "Font",
  },
  element: { mimes: IMAGE_MIMES, maxBytes: 10 * MB, label: "Element" },
  pattern: { mimes: IMAGE_MIMES, maxBytes: 10 * MB, label: "Pattern" },
  product_photo: { mimes: IMAGE_MIMES, maxBytes: 10 * MB, label: "Product photo" },
  inspiration_image: { mimes: IMAGE_MIMES, maxBytes: 10 * MB, label: "Example post" },
  inspiration_video: {
    mimes: ["video/mp4", "video/webm", "video/quicktime"],
    maxBytes: 50 * MB,
    label: "Example video",
  },
};

export const FONT_EXTENSIONS = ["woff2", "woff", "ttf", "otf"] as const;
export const MAX_VIDEO_FRAMES = 4;
export const MAX_WRITING_SAMPLE_CHARS = 20_000;
export const MAX_STYLES_PER_WORKSPACE = 40;
export const MAX_KIT_ASSETS_PER_WORKSPACE = 400;

export const KIT_SECTIONS = [
  { id: "styles", label: "Styles" },
  { id: "logos", label: "Logos" },
  { id: "colors", label: "Colors" },
  { id: "fonts", label: "Fonts" },
  { id: "elements", label: "Elements" },
  { id: "inspiration", label: "Examples" },
  { id: "writing", label: "Writing" },
] as const;
export type KitSection = (typeof KIT_SECTIONS)[number]["id"];

export function styleOptionFrom(
  view: BrandStyleView,
  dna?: BrandKitDnaSummary | null,
): StyleOption {
  const p = view.spec.visual?.palette ?? {};
  const inherit = view.spec.inherit ?? {};
  let swatches = [p.primary, p.secondary, p.accent, p.background].filter(Boolean) as string[];
  if (!swatches.length && inherit.colors !== false && dna?.colors.length) {
    swatches = dna.colors.slice(0, 4).map((c) => c.hex);
  }
  const t = view.spec.visual?.typography ?? {};
  const dnaFonts = inherit.fonts !== false ? (dna?.fonts ?? []) : [];
  return {
    id: view.id,
    name: view.name,
    isDefault: view.isDefault,
    appliesTo: view.appliesTo,
    swatches: swatches.slice(0, 4),
    headingFont: t.heading ?? dnaFonts[0] ?? null,
    bodyFont: t.body ?? dnaFonts[1] ?? dnaFonts[0] ?? null,
  };
}
