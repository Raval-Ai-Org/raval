// One-tap starting points on the Studio start screen. Each picks the format,
// platforms and settings for a ready-to-post result (captions included), and
// puts a short lead-in in the prompt box so the user only adds the topic.
import type { PlatformId } from "@/lib/social-platforms";
import type { StudioType } from "./formats";
import type { StudioControls } from "./jobs";

export type QuickStart = {
  id: string;
  label: string;
  type: StudioType;
  /** Empty for formats that aren't platform-bound (articles). */
  platforms: PlatformId[];
  controls?: Partial<StudioControls>;
  /** Lead-in for the prompt box; the user finishes the sentence. */
  prompt: string;
};

export const QUICK_STARTS: QuickStart[] = [
  {
    id: "instagram-post",
    label: "Instagram post",
    type: "image",
    platforms: ["instagram"],
    controls: { ratio: "4:5" },
    prompt: "An Instagram post with a caption about ",
  },
  {
    id: "linkedin-post",
    label: "LinkedIn post",
    type: "social",
    platforms: ["linkedin"],
    controls: { includeImage: false },
    prompt: "A LinkedIn post about ",
  },
  {
    id: "post-everywhere",
    label: "Post everywhere",
    type: "social",
    platforms: ["linkedin", "instagram", "facebook", "twitter"],
    controls: { includeImage: true, ratio: "1:1" },
    prompt: "A post for every platform about ",
  },
  {
    id: "carousel",
    label: "Carousel",
    type: "carousel",
    platforms: ["instagram"],
    controls: { ratio: "4:5", slideCount: 6 },
    prompt: "A carousel with a caption about ",
  },
  {
    id: "reel-script",
    label: "Reel script",
    type: "script",
    platforms: ["instagram"],
    controls: { durationSec: 30 },
    prompt: "A Reel script with a caption about ",
  },
  {
    id: "short-video",
    label: "Short video",
    type: "video",
    platforms: ["instagram", "tiktok"],
    controls: { ratio: "9:16", durationSec: 6 },
    prompt: "A short video with captions about ",
  },
  {
    id: "ad-variants",
    label: "Ad variants",
    type: "ad",
    platforms: ["facebook", "instagram"],
    controls: { ratio: "4:5" },
    prompt: "Ad variants promoting ",
  },
  {
    id: "blog-article",
    label: "Blog article",
    type: "article",
    platforms: [],
    controls: { length: "standard" },
    prompt: "A blog article about ",
  },
];
