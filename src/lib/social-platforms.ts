import {
  Linkedin,
  Twitter,
  Instagram,
  Facebook,
  Youtube,
  MessageCircle,
  Music2,
  type LucideIcon,
} from "@/components/ui/gemini-icons";

export type PlatformId =
  "linkedin" | "twitter" | "instagram" | "facebook" | "threads" | "tiktok" | "youtube";

export type PlatformSpec = {
  id: PlatformId;
  label: string;
  icon: LucideIcon;
  color: string;
  /** Hard cap on body text */
  maxChars: number;
  /** Sweet spot for virality */
  optimalChars: number;
  /** Suggested hashtag count */
  hashtags: [number, number];
  /** Style guidance fed to the model */
  style: string;
};

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    icon: Linkedin,
    color: "#0A66C2",
    maxChars: 3000,
    optimalChars: 1300,
    hashtags: [3, 5],
    style:
      "Professional, insight-led. Strong first line (the 'hook') visible above the fold — under 140 chars. Use short paragraphs and line breaks for scannability. Add a clear point of view, 2-3 concrete proof points or numbers, and end with one open question. No emoji walls; 0-2 emojis max. 3-5 niche hashtags at the end.",
  },
  twitter: {
    id: "twitter",
    label: "X / Twitter",
    icon: Twitter,
    color: "#0F1419",
    maxChars: 280,
    optimalChars: 240,
    hashtags: [0, 2],
    style:
      "Ruthlessly tight. ONE idea. Hook in the first 7 words. Plain language, no marketing fluff. Total must fit in 280 characters including hashtags and link. 0-2 hashtags max, only if they actually help discovery.",
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    icon: Instagram,
    color: "#E1306C",
    maxChars: 2200,
    optimalChars: 150,
    hashtags: [8, 12],
    style:
      "Caption-style. First line is the hook (visible before 'more'). Use 2-4 short lines, friendly tone, 1-3 tasteful emojis. End with a CTA (save / share / comment). Append 8-12 hashtags on a new line — mix broad, niche, and branded.",
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    maxChars: 2000,
    optimalChars: 450,
    hashtags: [1, 3],
    style:
      "Conversational, community-first. 80-120 word sweet spot. Tell a tiny story or share a useful tip, then ask the audience something. 1-3 hashtags only.",
  },
  threads: {
    id: "threads",
    label: "Threads",
    icon: MessageCircle,
    color: "#000000",
    maxChars: 500,
    optimalChars: 380,
    hashtags: [0, 1],
    style:
      "Casual, opinionated, human. No corporate tone. Punchy hook, one sharp take, optional one-line follow-up. 0-1 hashtag.",
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    icon: Music2,
    color: "#FE2C55",
    maxChars: 2200,
    optimalChars: 150,
    hashtags: [4, 8],
    style:
      "Caption for a short video. Open with curiosity gap or POV. 1-2 short lines, trend-aware. End with 4-8 trending + niche hashtags. Emojis welcome but sparingly.",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    icon: Youtube,
    color: "#FF0000",
    maxChars: 1000,
    optimalChars: 500,
    hashtags: [3, 5],
    style:
      "Community-post / Shorts caption. Start with the value proposition in line 1. 2-4 sentences. Optional one link CTA. 3-5 relevant hashtags at the end (one with the channel/brand).",
  },
};

export const PLATFORM_ORDER: PlatformId[] = [
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
];

export const DEFAULT_PLATFORMS: PlatformId[] = ["linkedin", "twitter", "instagram"];
