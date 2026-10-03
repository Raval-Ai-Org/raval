// Where a piece appears on a network (feed, Reels or Stories) and what Mellox
// can honestly do there through Post for Me. Pure and browser-safe.
//
// Source of truth for capabilities: Post for Me's API (SDK post-for-me 2.9,
// docs "Posting Instagram and Facebook Stories" and "Posting Reels and
// Stories"). Stories exist for Instagram and Facebook only; Threads has feed
// and Reels; every other network has a single feed. When several media items
// are sent with the `stories` placement, each becomes its own Story frame and
// counts separately toward the provider's post limits.
import type { PlatformId } from "@/lib/social-platforms";

export type Placement = "feed" | "reels" | "stories";
/** Post for Me's own names. */
export type ProviderPlacement = "timeline" | "reels" | "stories";

export const STORY_PLATFORMS = ["instagram", "facebook"] as const satisfies readonly PlatformId[];
export type StoryPlatform = (typeof STORY_PLATFORMS)[number];

const PLACEMENTS: Record<PlatformId, readonly Placement[]> = {
  instagram: ["feed", "reels", "stories"],
  facebook: ["feed", "reels", "stories"],
  threads: ["feed", "reels"],
  linkedin: ["feed"],
  twitter: ["feed"],
  tiktok: ["feed"],
  youtube: ["feed"],
};

export function placementsFor(platform: string): readonly Placement[] {
  return PLACEMENTS[platform as PlatformId] ?? ["feed"];
}

export function supportsPlacement(platform: string, placement: Placement): boolean {
  return placementsFor(platform).includes(placement);
}

export function isStoryPlatform(platform: unknown): platform is StoryPlatform {
  return typeof platform === "string" && (STORY_PLATFORMS as readonly string[]).includes(platform);
}

export function isPlacement(value: unknown): value is Placement {
  return value === "feed" || value === "reels" || value === "stories";
}

export function toProviderPlacement(placement: Placement): ProviderPlacement {
  return placement === "feed" ? "timeline" : placement;
}

/**
 * Where a content item goes on its platform. A Story item always goes to
 * Stories; a video on Instagram or Facebook goes to Reels unless it says
 * otherwise; anything else goes to the feed. Null means "the network's only
 * placement" (send no placement at all).
 */
export function placementForItem(item: { kind?: string | null; meta?: unknown }): Placement | null {
  const meta =
    item.meta && typeof item.meta === "object" ? (item.meta as Record<string, unknown>) : {};
  const platform = typeof meta.platform === "string" ? meta.platform : "";
  if (placementsFor(platform).length === 1) return null;
  if (item.kind === "story" || meta.studio_type === "story") {
    return supportsPlacement(platform, "stories") ? "stories" : null;
  }
  const asked = isPlacement(meta.placement) ? meta.placement : null;
  if (asked && supportsPlacement(platform, asked)) return asked;
  const video =
    item.kind === "video" || meta.media_type === "video" || meta.studio_type === "video";
  return video && supportsPlacement(platform, "reels") ? "reels" : "feed";
}

export function isStoryItem(item: { kind?: string | null; meta?: unknown }): boolean {
  const meta =
    item.meta && typeof item.meta === "object" ? (item.meta as Record<string, unknown>) : {};
  return item.kind === "story" || meta.studio_type === "story" || meta.placement === "stories";
}

/** Story canvas and limits. 9:16 at 1080×1920 is what both networks recommend. */
export const STORY_CANVAS = { width: 1080, height: 1920, ratio: "9:16" } as const;

/**
 * Keep text out of these bands: the top holds the progress bar and profile
 * name, the bottom holds the reply bar. Fractions of the frame height.
 */
export const STORY_SAFE_ZONE = { top: 250 / 1920, bottom: 340 / 1920 } as const;

/** Stories disappear from the profile after this long. */
export const STORY_LIFETIME_HOURS = 24;

/** The longest video Mellox sends as one Story frame. */
export const STORY_VIDEO_MAX_SECONDS = 60;

/**
 * Story features people expect, and whether an API-published Story can carry
 * them. Only what Post for Me really exposes is marked supported; the rest get
 * an honest alternative in the design instead of a fake sticker.
 */
export const STORY_FEATURES: {
  id: string;
  label: string;
  supported: boolean;
  how: string;
}[] = [
  {
    id: "frames",
    label: "Several frames in order",
    supported: true,
    how: "Each frame is posted as its own Story, in order.",
  },
  {
    id: "video",
    label: "Video Stories",
    supported: true,
    how: "A vertical video goes out as a Story with its own sound.",
  },
  {
    id: "mentions",
    label: "Mention accounts (Instagram)",
    supported: true,
    how: "Instagram usernames are tagged on the Story.",
  },
  {
    id: "schedule",
    label: "Schedule ahead",
    supported: true,
    how: "Mellox schedules it and checks it went out.",
  },
  {
    id: "link",
    label: "Link sticker",
    supported: false,
    how: "Not available when posting through an API. Mellox writes your web address on the last frame and says 'link in bio'.",
  },
  {
    id: "poll",
    label: "Poll and question stickers",
    supported: false,
    how: "Not available through an API. Use an 'Ask your audience' frame: people answer by replying, which comes to your inbox.",
  },
  {
    id: "music",
    label: "Music from the Instagram library",
    supported: false,
    how: "Not available through an API. A video Story keeps the sound of the video itself.",
  },
  {
    id: "location",
    label: "Location and hashtag stickers",
    supported: false,
    how: "Not available for Stories through an API.",
  },
];

/** Instagram usernames, cleaned: no @, letters/numbers/._ only, at most 5. */
export function cleanMentions(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const out: string[] = [];
  for (const value of list) {
    if (typeof value !== "string") continue;
    const name = value.trim().replace(/^@+/, "").toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length >= 5) break;
  }
  return out;
}
