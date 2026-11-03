// Plain words for a learned preference, taken from the modules that own each
// choice. A value with no label is never shown (it can still steer a picker).

import { ARCHETYPES } from "@/lib/studio/art-direction";
import { getAdFormat } from "@/lib/studio/ad-formats";
import { getCarouselStructure } from "@/lib/studio/carousel/story";
import { isStudioType, STUDIO_FORMATS } from "@/lib/studio/formats";
import { HOOK_STYLES } from "@/lib/studio/memory";
import { ANGLES } from "@/lib/studio/prompts";
import { getStoryTheme } from "@/lib/stories/frames";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import type { TraitKind } from "./contracts";

const COLORWAY: Record<string, string> = {
  light: "Light backgrounds",
  dark: "Dark backgrounds",
  brand: "Brand-colour backgrounds",
};

const RATIO: Record<string, string> = {
  "1:1": "Square posts",
  "4:5": "Portrait posts",
  "9:16": "Tall posts",
  "16:9": "Wide posts",
};

/** What the prompt calls each kind of choice. */
export const KIND_LABEL: Record<TraitKind, string> = {
  format: "Format",
  platform: "Platform",
  aim: "Aim",
  hook: "Opening",
  angle: "Angle",
  adFormat: "Ad layout",
  layout: "Picture layout",
  colorway: "Carousel background",
  motif: "Carousel motif",
  structure: "Carousel story",
  storyTheme: "Story theme",
  ratio: "Shape",
};

export function traitLabel(kind: TraitKind, value: string): string | null {
  switch (kind) {
    case "format":
      return isStudioType(value) ? STUDIO_FORMATS[value].label : null;
    case "platform":
      return value in PLATFORMS ? PLATFORMS[value as PlatformId].label : null;
    case "hook": {
      const h = HOOK_STYLES.find((s) => s.id === value);
      return h ? `Opens with ${h.label.charAt(0).toLowerCase()}${h.label.slice(1)}` : null;
    }
    case "angle":
      return ANGLES.find((a) => a.id === value)?.label ?? null;
    case "adFormat":
      return getAdFormat(value)?.label ?? null;
    case "layout":
      return ARCHETYPES.find((a) => a.id === value)?.name ?? null;
    case "colorway":
      return COLORWAY[value] ?? null;
    case "structure":
      return getCarouselStructure(value)?.label ?? null;
    case "storyTheme":
      return getStoryTheme(value)?.label ?? null;
    case "ratio":
      return RATIO[value] ?? null;
    default:
      return null;
  }
}
