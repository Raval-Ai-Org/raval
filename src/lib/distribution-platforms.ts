// distribution-platforms.ts — which platforms each distribution provider can
// publish to, with display metadata. Client-safe (no secrets, no env): the
// server decides the active provider and returns its platform ids from
// GET /api/sdr/status; components render from this catalog.
//
// Wire ids match Mellox's PlatformId (`twitter`, not `x`) and SocialAPI's
// platform slugs, which are identical for every platform listed here.

export type DistributionProvider = "socialapi" | "sdr";

export type DistributionPlatformId =
  "linkedin" | "twitter" | "instagram" | "facebook" | "threads" | "tiktok" | "youtube";

export type DistributionPlatformMeta = {
  id: DistributionPlatformId;
  label: string;
  /** BrandLogo name. */
  logo: "linkedin" | "x" | "instagram" | "facebook" | "threads" | "tiktok" | "youtube";
  /** Brand tint; omitted for monochrome marks (X, Threads) so they follow text colour. */
  tint?: string;
  description: string;
  /** Shown before connecting — platform requirements the user must meet. */
  connectNote?: string;
};

export const DISTRIBUTION_PLATFORMS: Record<DistributionPlatformId, DistributionPlatformMeta> = {
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    logo: "linkedin",
    tint: "#0A66C2",
    description: "Professional updates and thought leadership",
    connectNote: "Posts publish to your personal LinkedIn profile.",
  },
  twitter: {
    id: "twitter",
    label: "X",
    logo: "x",
    description: "Short-form updates and launches",
    connectNote:
      "X requires your own X developer app credentials to be configured with the publishing provider before connecting. X posts are text-only.",
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    logo: "instagram",
    tint: "#E1306C",
    description: "Visual stories and feed content",
    connectNote:
      "Use an Instagram Business or Creator account. Every post needs an image or video.",
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    logo: "facebook",
    tint: "#1877F2",
    description: "Pages, communities, and announcements",
    connectNote: "After authorizing, you'll choose which Facebook Pages to connect.",
  },
  threads: {
    id: "threads",
    label: "Threads",
    logo: "threads",
    description: "Conversational posts and quick takes",
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    logo: "tiktok",
    tint: "#FE2C55",
    description: "Short video",
    connectNote:
      "TikTok posts need a video or photos, and TikTok requires choosing who can see each post.",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    logo: "youtube",
    tint: "#FF0000",
    description: "Video uploads",
    connectNote: "YouTube posts need a video and a title.",
  },
};

/** Publishing platforms per provider, in display order. */
export const PROVIDER_PLATFORMS: Record<DistributionProvider, DistributionPlatformId[]> = {
  socialapi: ["linkedin", "twitter", "instagram", "facebook", "threads", "tiktok", "youtube"],
  sdr: ["twitter", "linkedin", "facebook", "instagram"],
};

// Scheduling is not gated here: SocialAPI holds every scheduled post in its own
// queue for all publishing platforms (docs: posts/scheduling), and platform
// rules are checked by the provider's POST /posts/validate before submission.

export function isDistributionPlatform(value: unknown): value is DistributionPlatformId {
  return typeof value === "string" && value in DISTRIBUTION_PLATFORMS;
}
