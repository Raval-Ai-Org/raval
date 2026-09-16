// UGC ad brief vocabulary: objectives, platforms (with presets), formats,
// tones, languages, creator personas and CTAs. Pure — the UI renders these as
// choices, the concept engine and prompt builder turn them into direction.
import type { UgcAspectRatio } from "./models";

type Option<T extends string> = { id: T; label: string; hint: string };

export const OBJECTIVES = [
  { id: "sales", label: "Sales", hint: "Drive purchases now" },
  { id: "conversion", label: "Conversion", hint: "Sign-ups, trials, add-to-cart" },
  { id: "awareness", label: "Awareness", hint: "Make the product memorable" },
  { id: "engagement", label: "Engagement", hint: "Comments, shares, saves" },
  { id: "app_install", label: "App install", hint: "Get the app downloaded" },
  { id: "lead_gen", label: "Lead generation", hint: "Book a call, get a quote" },
] as const satisfies readonly Option<string>[];
export type ObjectiveId = (typeof OBJECTIVES)[number]["id"];

export type PlatformPreset = {
  id: "tiktok" | "reels" | "shorts" | "facebook";
  label: string;
  hint: string;
  aspectRatio: UgcAspectRatio;
  /** Preferred clip length; snapped to what the model supports. */
  durationSec: number;
  /** Direction that makes the ad feel native to the feed. */
  native: string;
};

export const PLATFORMS: readonly PlatformPreset[] = [
  {
    id: "tiktok",
    label: "TikTok",
    hint: "Vertical, fast, creator-first",
    aspectRatio: "9:16",
    durationSec: 8,
    native:
      "native TikTok creator video: talking straight to the phone camera, quick pattern-interrupt in the first second, casual jump-cut energy",
  },
  {
    id: "reels",
    label: "Instagram Reels",
    hint: "Vertical, polished-casual",
    aspectRatio: "9:16",
    durationSec: 8,
    native:
      "Instagram Reels creator video: vertical, bright and aesthetically clean but still handheld and personal",
  },
  {
    id: "shorts",
    label: "YouTube Shorts",
    hint: "Vertical, clear value fast",
    aspectRatio: "9:16",
    durationSec: 8,
    native:
      "YouTube Shorts creator video: vertical, gets to the value immediately, clear demonstration",
  },
  {
    id: "facebook",
    label: "Facebook",
    hint: "Feed video, sound-optional",
    aspectRatio: "1:1",
    durationSec: 8,
    native:
      "Facebook feed video from a real customer: the product and its benefit are understandable even with the sound off",
  },
];
export type PlatformId = PlatformPreset["id"];

export const FORMATS = [
  { id: "testimonial", label: "Testimonial", hint: "A happy customer shares results" },
  { id: "problem_solution", label: "Problem → Solution", hint: "Relatable pain, product fixes it" },
  { id: "demo", label: "Product demo", hint: "Show it working, hands-on" },
  { id: "unboxing", label: "Unboxing", hint: "First look and reaction" },
  { id: "before_after", label: "Before / After", hint: "The change the product makes" },
  { id: "storytelling", label: "Storytelling", hint: "A short personal story" },
  { id: "founder", label: "Founder-style", hint: "The maker explains why it exists" },
  { id: "review", label: "Honest review", hint: "Balanced, credible verdict" },
  { id: "educational", label: "Educational", hint: "Teach a tip, product is the tool" },
  { id: "viral_hook", label: "Viral hook", hint: "Scroll-stopping opener first" },
] as const satisfies readonly Option<string>[];
export type FormatId = (typeof FORMATS)[number]["id"];

export const TONES = [
  { id: "authentic", label: "Authentic", hint: "Real, unscripted feel" },
  { id: "energetic", label: "Energetic", hint: "Upbeat and fast" },
  { id: "professional", label: "Professional", hint: "Credible and composed" },
  { id: "emotional", label: "Emotional", hint: "Heartfelt and personal" },
  { id: "funny", label: "Funny", hint: "Light, playful humour" },
  { id: "bold", label: "Bold", hint: "Confident, direct claims" },
  { id: "minimal", label: "Minimal", hint: "Calm, few words" },
] as const satisfies readonly Option<string>[];
export type ToneId = (typeof TONES)[number]["id"];

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "pt", label: "Portuguese" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "nl", label: "Dutch" },
  { id: "hi", label: "Hindi" },
  { id: "ur", label: "Urdu" },
  { id: "ar", label: "Arabic" },
  { id: "tr", label: "Turkish" },
  { id: "id", label: "Indonesian" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese (Mandarin)" },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]["id"];

export const CREATOR_GENDERS = [
  { id: "any", label: "Any" },
  { id: "woman", label: "Woman" },
  { id: "man", label: "Man" },
] as const;
export const CREATOR_AGES = [
  { id: "any", label: "Any age" },
  { id: "18-24", label: "18–24" },
  { id: "25-34", label: "25–34" },
  { id: "35-44", label: "35–44" },
  { id: "45-60", label: "45–60" },
] as const;
export const CREATOR_VIBES = [
  { id: "friendly", label: "Friendly", prompt: "warm, friendly and approachable" },
  { id: "expert", label: "Expert", prompt: "knowledgeable and credible, like a trusted expert" },
  { id: "hype", label: "Hype", prompt: "excited and high-energy" },
  { id: "calm", label: "Calm", prompt: "calm, relaxed and reassuring" },
  { id: "relatable", label: "Relatable", prompt: "down-to-earth and relatable, like a friend" },
] as const;
export const SETTINGS = [
  { id: "auto", label: "Best fit", prompt: "" },
  { id: "home", label: "Living room", prompt: "a lived-in, tidy living room" },
  { id: "kitchen", label: "Kitchen", prompt: "a bright home kitchen" },
  { id: "bathroom", label: "Bathroom", prompt: "a clean bathroom with a mirror" },
  { id: "bedroom", label: "Bedroom", prompt: "a cosy bedroom" },
  { id: "car", label: "Car", prompt: "the driver's seat of a parked car" },
  { id: "office", label: "Desk", prompt: "a home-office desk" },
  { id: "gym", label: "Gym", prompt: "a gym" },
  { id: "outdoors", label: "Outdoors", prompt: "outdoors in natural daylight" },
] as const;

export type CreatorGender = (typeof CREATOR_GENDERS)[number]["id"];
export type CreatorAge = (typeof CREATOR_AGES)[number]["id"];
export type CreatorVibe = (typeof CREATOR_VIBES)[number]["id"];
export type SettingId = (typeof SETTINGS)[number]["id"];

export const CTA_PRESETS: Record<ObjectiveId, string[]> = {
  sales: ["Shop now", "Get yours today", "Tap to order"],
  conversion: ["Start your free trial", "Sign up today", "Try it now"],
  awareness: ["Check it out", "Follow for more", "See it for yourself"],
  engagement: ["Tell me in the comments", "Save this for later", "Share with a friend"],
  app_install: ["Download the app", "Get the app free", "Install now"],
  lead_gen: ["Book a free call", "Get a free quote", "Learn more"],
};

export function platformPreset(id: PlatformId): PlatformPreset {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
}

export function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string) {
  return list.find((o) => o.id === id)?.label ?? id;
}
