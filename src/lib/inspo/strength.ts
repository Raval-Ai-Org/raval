// "Style strength": how much Mellox knows about the brand's look and voice.
// Pure, free, from what is saved. It never claims anything about results.

import type { BrandLookSpec } from "@/lib/brand-look/spec";
import type { InspoCard } from "./board";

export type StrengthStep = { id: string; label: string; done: boolean; section: string };

export function styleSteps(args: {
  look: BrandLookSpec;
  cards: InspoCard[];
  hasLogo: boolean;
  hasDirection: boolean;
}): StrengthStep[] {
  const { look, cards } = args;
  const v = look.visual ?? {};
  const w = look.writing ?? {};
  const likes = cards.filter((c) => c.chip === "like").length;
  return [
    { id: "likes", label: "3 posts you like", done: likes >= 3, section: "board" },
    { id: "direction", label: "Learn my style", done: args.hasDirection, section: "board" },
    { id: "vibe", label: "Pick a vibe", done: !!(v.medium || v.mood), section: "post" },
    {
      id: "colours",
      label: "Colours & fonts",
      done: !!(v.palette || v.typography?.heading),
      section: "post",
    },
    { id: "logo", label: "Logo", done: args.hasLogo, section: "post" },
    {
      id: "video",
      label: "Video look",
      done: !!(look.video?.pacing || look.video?.captions),
      section: "video",
    },
    { id: "voice", label: "Voice", done: !!(w.tone || w.emoji || w.person), section: "voice" },
    { id: "examples", label: "An example post", done: !!w.examples?.length, section: "voice" },
    {
      id: "media",
      label: "Your photos",
      done: cards.some((c) => c.shelf === "media"),
      section: "media",
    },
  ];
}

/** 0..100 and a one-word level. */
export function styleStrength(steps: StrengthStep[]): { score: number; level: string } {
  const score = steps.length
    ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100)
    : 0;
  const level =
    score >= 80 ? "Strong" : score >= 45 ? "Good" : score > 0 ? "Getting started" : "Empty";
  return { score, level };
}
