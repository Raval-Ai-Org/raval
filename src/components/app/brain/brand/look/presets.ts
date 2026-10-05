// Starter looks — one tap sets the feel of a brand's content. Pure data: no
// model call, nothing invented about the brand. A starter never sets colours
// or fonts (those are the brand's own); it sets mood, image look, tone and pace.
import type { VideoStyle, VisualStyle, WritingStyle } from "@/lib/brand-look/spec";

export type LookPreset = {
  id: string;
  label: string;
  /** CSS background for the card. */
  art: string;
  writing: Partial<WritingStyle>;
  visual: Partial<VisualStyle>;
  video: Partial<VideoStyle>;
};

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: "clean",
    label: "Clean",
    art: "linear-gradient(135deg, #fafafa 0%, #e9ecef 100%)",
    writing: {
      tone: { casual: 45, playful: 25, detailed: 35, bold: 40 },
      emoji: "none",
      sentenceLength: "short",
    },
    visual: {
      medium: "photo",
      mood: "clean and minimal, calm, lots of breathing room",
      whitespace: "generous",
      composition: "one clear subject, plenty of empty space, simple grid",
    },
    video: { pacing: "steady" },
  },
  {
    id: "bold",
    label: "Bold",
    art: "linear-gradient(135deg, #111 0%, #111 55%, #f9d423 55%, #ff4e50 100%)",
    writing: {
      tone: { casual: 60, playful: 45, detailed: 25, bold: 90 },
      emoji: "light",
      sentenceLength: "short",
    },
    visual: {
      medium: "typographic",
      mood: "bold and energetic, high contrast, confident",
      whitespace: "minimal",
      composition: "big headline that fills the frame, strong colour blocks",
    },
    video: { pacing: "fast" },
  },
  {
    id: "warm",
    label: "Warm",
    art: "linear-gradient(135deg, #ffe8d6 0%, #ddbea9 50%, #cb997e 100%)",
    writing: {
      tone: { casual: 75, playful: 50, detailed: 45, bold: 45 },
      emoji: "light",
      person: "we",
    },
    visual: {
      medium: "photo",
      mood: "warm and friendly, soft, human",
      lighting: "soft natural light",
      whitespace: "balanced",
      composition: "real people and hands, close and candid",
    },
    video: { pacing: "steady" },
  },
  {
    id: "premium",
    label: "Premium",
    art: "linear-gradient(135deg, #1b1b1f 0%, #2d2a32 60%, #b08d57 100%)",
    writing: {
      tone: { casual: 25, playful: 15, detailed: 45, bold: 50 },
      emoji: "none",
      sentenceLength: "mixed",
    },
    visual: {
      medium: "photo",
      mood: "premium and refined, understated, elegant",
      lighting: "soft directional light with deep shadows",
      whitespace: "generous",
      composition: "one hero object, centred, lots of quiet space",
    },
    video: { pacing: "slow" },
  },
  {
    id: "playful",
    label: "Playful",
    art: "linear-gradient(135deg, #ff9a9e 0%, #fad0c4 35%, #a1c4fd 70%, #c2e9fb 100%)",
    writing: {
      tone: { casual: 90, playful: 90, detailed: 30, bold: 65 },
      emoji: "heavy",
      sentenceLength: "short",
    },
    visual: {
      medium: "illustration",
      mood: "playful and colourful, fun, lively",
      whitespace: "balanced",
      composition: "rounded shapes, stickers and simple characters",
    },
    video: { pacing: "fast" },
  },
  {
    id: "dark",
    label: "Dark",
    art: "radial-gradient(circle at 30% 20%, #3a3f5c 0%, #12131c 60%, #05060a 100%)",
    writing: {
      tone: { casual: 40, playful: 20, detailed: 40, bold: 75 },
      emoji: "none",
      sentenceLength: "mixed",
    },
    visual: {
      medium: "3d",
      mood: "dark and moody, dramatic, cinematic",
      lighting: "low key with one strong rim light",
      whitespace: "balanced",
      composition: "subject lit against a dark background",
    },
    video: { pacing: "steady" },
  },
];
