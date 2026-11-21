// Aspect ratios Studio can produce, and the platform-aware defaults that pick
// one for the user. Pure — shared by the composer, previews, and the server.
import type { PlatformId } from "@/lib/social-platforms";

export type AspectRatio = "1:1" | "4:5" | "16:9" | "9:16" | "3:4" | "4:3" | "2:3";

export type RatioMeta = {
  id: AspectRatio;
  label: string;
  /** Width / height, for layout math. */
  w: number;
  h: number;
  use: string;
};

export const RATIOS: Record<AspectRatio, RatioMeta> = {
  "1:1": { id: "1:1", label: "Square", w: 1, h: 1, use: "Feeds everywhere" },
  "4:5": { id: "4:5", label: "Portrait", w: 4, h: 5, use: "Instagram & Facebook feed" },
  "16:9": { id: "16:9", label: "Landscape", w: 16, h: 9, use: "LinkedIn, X, YouTube" },
  "9:16": { id: "9:16", label: "Vertical", w: 9, h: 16, use: "Stories, Reels, TikTok" },
  "3:4": { id: "3:4", label: "Portrait 3:4", w: 3, h: 4, use: "Tall portrait" },
  "4:3": { id: "4:3", label: "Classic", w: 4, h: 3, use: "Presentations" },
  "2:3": { id: "2:3", label: "Tall", w: 2, h: 3, use: "Pinterest" },
};

/** Image sizes the generation route accepts, keyed by ratio. */
export type StudioImageSize = "1024x1024" | "1024x1280" | "1792x1024" | "1024x1792" | "1024x1536";

export const IMAGE_SIZE_BY_RATIO: Partial<Record<AspectRatio, StudioImageSize>> = {
  "1:1": "1024x1024",
  "4:5": "1024x1280",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
  "2:3": "1024x1536",
};

/** Feed posts take pictures between these shapes (Instagram's range, the strictest). */
export const FEED_MIN_ASPECT = 0.8;
export const FEED_MAX_ASPECT = 1.91;

/**
 * The canvas a photo posted as is must be fitted to (shown whole, nothing
 * cut), or null when it can go out unchanged: only a feed-shaped piece whose
 * photo falls outside what feeds accept (a 9:16 phone photo for a 4:5 post,
 * a panorama) is fitted. Stories and tall formats take any photo.
 */
export function sourcePhotoCanvas(
  photo: { width: number; height: number },
  ratio: AspectRatio,
): { width: number; height: number } | null {
  if (!photo.width || !photo.height) return null;
  const target = RATIOS[ratio].w / RATIOS[ratio].h;
  if (target < FEED_MIN_ASPECT || target > FEED_MAX_ASPECT) return null;
  const aspect = photo.width / photo.height;
  // A hair of tolerance: a 1080×1351 export is still a 4:5 post.
  if (aspect >= FEED_MIN_ASPECT * 0.99 && aspect <= FEED_MAX_ASPECT * 1.01) return null;
  // Keep the photo's own detail: 1080 to 1440 on the long side.
  const long = Math.max(1080, Math.min(1440, Math.max(photo.width, photo.height)));
  return target >= 1
    ? { width: long, height: Math.round(long / target) }
    : { width: Math.round(long * target), height: long };
}

export const IMAGE_RATIOS: AspectRatio[] = ["1:1", "4:5", "16:9", "9:16", "2:3"];
export const VIDEO_RATIOS: AspectRatio[] = ["9:16", "1:1", "16:9", "4:3", "3:4"];

/** The best-performing in-feed ratio per platform. */
export const FEED_RATIO_BY_PLATFORM: Record<PlatformId, AspectRatio> = {
  instagram: "4:5",
  facebook: "4:5",
  linkedin: "1:1",
  twitter: "16:9",
  threads: "4:5",
  tiktok: "9:16",
  youtube: "16:9",
  pinterest: "2:3",
};

/** Short-form video default per platform. */
export const VIDEO_RATIO_BY_PLATFORM: Record<PlatformId, AspectRatio> = {
  instagram: "9:16",
  facebook: "9:16",
  tiktok: "9:16",
  youtube: "9:16",
  threads: "9:16",
  linkedin: "1:1",
  twitter: "16:9",
  pinterest: "2:3",
};

/**
 * One ratio that serves every selected platform reasonably. The first platform
 * the user picked leads; if the set mixes vertical-first and landscape-first
 * channels, square is the honest compromise.
 */
export function recommendedRatio(
  platforms: PlatformId[],
  kind: "image" | "video" = "image",
  allowed: AspectRatio[] = kind === "video" ? VIDEO_RATIOS : IMAGE_RATIOS,
): AspectRatio {
  const table = kind === "video" ? VIDEO_RATIO_BY_PLATFORM : FEED_RATIO_BY_PLATFORM;
  const picks = [...new Set(platforms.map((p) => table[p]))].filter((r) => allowed.includes(r));
  if (picks.length === 1) return picks[0];
  if (picks.length > 1) {
    const vertical = picks.every((r) => RATIOS[r].h > RATIOS[r].w);
    if (vertical) return picks[0];
    return allowed.includes("1:1") ? "1:1" : picks[0];
  }
  return allowed[0];
}

export function ratioStyle(ratio: AspectRatio): { aspectRatio: string } {
  const r = RATIOS[ratio];
  return { aspectRatio: `${r.w} / ${r.h}` };
}

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && value in RATIOS;
}
