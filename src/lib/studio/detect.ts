// Guess which Studio format a one-line request is asking for, so a user can
// type "a carousel with 5 cold brew tips" and generate without choosing first.
// Pure and deliberately conservative: no match means "keep the current format".
import type { StudioType } from "./formats";

/** Checked in order — "video script" is a script, "carousel guide" is a carousel. */
const RULES: [StudioType, RegExp][] = [
  ["script", /\b(scripts?|reels?|tiktoks?|shorts|voice-?overs?|talking[- ]head)\b/i],
  ["carousel", /\b(carousels?|slides?|slideshows?|swipe(able)?)\b/i],
  ["article", /\b(articles?|blogs?|blog ?posts?|long[- ]?form|seo|newsletters?|how-to guides?)\b/i],
  ["ad", /\b(ads?|adverts?|advertisements?|sponsored|paid social)\b/i],
  ["video", /\b(videos?|clips?|footage|b-?roll|animations?|animated)\b/i],
  [
    "image",
    /\b(images?|photos?|photographs?|visuals?|graphics?|posters?|pictures?|illustrations?|quote cards?)\b/i,
  ],
  ["social", /\b(posts?|captions?|tweets?|threads|linkedin|instagram|facebook)\b/i],
];

export function detectStudioType(text: string): StudioType | null {
  const t = text.trim();
  if (t.length < 3) return null;
  for (const [type, re] of RULES) if (re.test(t)) return type;
  return null;
}
