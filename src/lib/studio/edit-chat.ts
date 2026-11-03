// The edit chat beside a finished piece: a person says what to change in
// their own words and this decides what that touches. The picture is edited
// on top of the current one; the words are rewritten; both is a fresh take;
// "versions" makes alternatives to choose from. Pure and browser-safe, so the
// panel can show the price of a message before it is sent.
import type { StudioType } from "./formats";
import { MAX_VARIATIONS, MIN_VARIATIONS, VARIATION_TARGET, VARIATION_TYPES } from "./variations";

export type EditAim = "picture" | "words" | "both" | "versions";

export type EditTurn = {
  id: string;
  text: string;
  aim: EditAim;
  /** The version the change was made from; Undo puts this one back. */
  fromJobId: string;
  /** The job that made the change, once the request was accepted. */
  jobId?: string;
  undone?: boolean;
  at: number;
};

const PICTURE =
  /\b(picture|image|photo|visual|background|colou?rs?|light|lighting|darker|brighter|shadows?|product|bigger|larger|smaller|zoom|crop|angle|camera|scene|setting|layout|logo|font|typeface|texture|composition|centre|center|move|person|people|model|hands?|outdoors?|indoors?|sky|table|blur|sharper|contrast|saturat\w*)\b/i;
const WORDS =
  /\b(caption|captions|copy|wording|words|hashtags?|emojis?|tone|voice|shorter|longer|rewrite|sentence|description|primary text|grammar|spelling|translate|friendlier|formal|casual|funnier|cta|call to action|headline|headlines)\b/i;
/** Words that are typeset on a designed ad, so changing them changes the picture too. */
const ON_PICTURE =
  /\b(headline|button|badge|title|label|offer|discount|on the (?:image|picture|ad)|in the (?:image|picture))\b/i;
const VERSIONS =
  /\b(variations?|versions?|options|alternatives|a few more|more like this|other takes?)\b/i;

const WORD_NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4 };

export type EditContext = {
  type: StudioType;
  /** The piece has a finished picture to edit. */
  hasPicture: boolean;
  /** An ad whose words are typeset on the picture (ad-formats.ts). */
  designedAd?: boolean;
};

export function planEdit(text: string, ctx: EditContext): { aim: EditAim; count?: number } {
  const t = text.trim();
  const picture = PICTURE.test(t);
  const words = WORDS.test(t);
  if (
    ctx.hasPicture &&
    (VARIATION_TYPES as readonly string[]).includes(ctx.type) &&
    VERSIONS.test(t)
  ) {
    const digit = t.match(/\b([2-9])\b/)?.[1];
    const word = t.toLowerCase().match(/\b(two|three|four)\b/)?.[1];
    const n = digit ? Number(digit) : word ? WORD_NUMBERS[word] : undefined;
    return {
      aim: "versions",
      ...(n ? { count: Math.min(MAX_VARIATIONS, Math.max(MIN_VARIATIONS, n)) } : {}),
    };
  }
  if (!ctx.hasPicture) return { aim: "words" };
  if (ctx.designedAd && ON_PICTURE.test(t)) return { aim: "both" };
  if (picture && words) return { aim: "both" };
  if (picture) return { aim: "picture" };
  if (words) return { aim: "words" };
  // "Make it feel more premium": the whole piece.
  return { aim: "both" };
}

/** The refine target the runner understands for an aim. */
export function editTarget(aim: EditAim, type: StudioType): string {
  switch (aim) {
    case "picture":
      return "media";
    case "versions":
      return VARIATION_TARGET;
    case "both":
      return "all";
    case "words":
      return ["social", "image", "video", "ad"].includes(type) ? "captions" : "all";
  }
}

export const AIM_LABEL: Record<EditAim, string> = {
  picture: "Picture",
  words: "Words",
  both: "Picture and words",
  versions: "More versions",
};

/** What the reply says once the change is made. */
export function replyFor(aim: EditAim, count?: number): string {
  switch (aim) {
    case "picture":
      return "Updated the picture. The words are unchanged.";
    case "words":
      return "Rewrote the words. The picture is unchanged.";
    case "both":
      return "Made a new take on the picture and the words.";
    case "versions":
      return `Made ${count ?? "a few"} more versions. Pick the one you like below the preview.`;
  }
}
