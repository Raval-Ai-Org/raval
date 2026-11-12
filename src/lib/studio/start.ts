// What each way of starting a piece asks for (pure, browser-safe).
//
// Create offers many starts that share one Studio composer: a video from an
// idea, the brand's own clips, a photo slideshow, a website tour, a looping
// post, a motion graphic. Each one asks for something different, so the
// composer's heading, its example and the one thing still missing come from
// here, and the Create cards say up front what a person brings ("You add:").
// The server's own checks (`studioJobInput` in jobs.ts) stay the rule; this
// only says the same thing earlier, in plain words.

import { STUDIO_FORMATS, type StudioType } from "./formats";
import type { StudioControls } from "./jobs";

export type StartId =
  | "idea"
  | "product"
  | "video-ad"
  | "motion-graphics"
  | "motion-post"
  | "clips"
  | "slideshow"
  | "site";

export type Start = {
  id: StartId;
  /** Heading before the highlighted word: "Edit your" + "clips". */
  lead: string;
  word: string;
  /** The example in the description box. */
  placeholder: string;
  /** What the person brings, for the Create cards. Null: just describe it. */
  needs: string | null;
  /** Short steps shown under the heading when something has to be added. */
  steps?: string[];
};

type Controls = Partial<
  Pick<
    StudioControls,
    "videoMode" | "videoKind" | "sourceVideoAssetIds" | "referenceAssetIds" | "recapMotion"
  >
>;

/** Which start a video session is, from its controls. */
export function startIdFor(type: StudioType, c: Controls): StartId | null {
  if (type !== "video") return null;
  if (c.videoMode === "brand") return "clips";
  if (c.videoMode === "site") return "site";
  if (c.videoMode === "recap") return c.videoKind === "motion-post" ? "motion-post" : "slideshow";
  if (c.videoMode === "motion") return "motion-graphics";
  if (
    c.videoKind === "product-demo" ||
    c.videoKind === "product-motion" ||
    c.videoKind === "product-showcase"
  )
    return "product";
  if (c.videoKind === "offer-teaser") return "video-ad";
  return "idea";
}

const STARTS: Record<StartId, Omit<Start, "id">> = {
  idea: {
    lead: "Describe your",
    word: "video",
    placeholder: STUDIO_FORMATS.video.placeholder,
    needs: null,
  },
  product: {
    lead: "Make your",
    word: "product video",
    placeholder: "e.g. Our travel mug keeping coffee hot on a cold morning hike",
    needs: "a product",
    steps: ["Pick the product below (its own photos are kept)", "Say the moment or offer to show"],
  },
  "video-ad": {
    lead: "Make your",
    word: "video ad",
    placeholder: "e.g. Our new running shoe, 20% off this week only. End with 'Shop now'",
    needs: "your offer",
    steps: ["Say the offer in your own words", "Pick a product below if it has one"],
  },
  "motion-graphics": {
    lead: "Describe your",
    word: "motion graphic",
    placeholder: "e.g. Summer sale, 30% off everything, ends Sunday. End with 'Shop now'",
    needs: null,
  },
  "motion-post": {
    lead: "Bring your",
    word: "post to life",
    placeholder: "e.g. Slow zoom on the product, then the headline slides in",
    needs: "1 picture",
    steps: ["Add the picture with “Photos or clips” in the box", "Say how it should move"],
  },
  clips: {
    lead: "Edit your",
    word: "clips",
    placeholder: "e.g. Our new store opening. End with 'Visit us this Saturday'",
    needs: "1 to 5 clips",
    steps: ["Add your clips with “Photos or clips” in the box", "Say what the video is for"],
  },
  slideshow: {
    lead: "Turn your photos into a",
    word: "video",
    placeholder: "e.g. Behind the scenes of our weekend market, warm and upbeat",
    needs: "2 to 6 photos",
    steps: [
      "Add 2 to 6 photos with “Photos or clips”, in play order",
      "Say what the video is about",
    ],
  },
  site: {
    lead: "Show off your",
    word: "website",
    placeholder: "e.g. A quick tour of our new menu page, end with 'Order online'",
    needs: "a page of your site",
    steps: ["Pick a page of your site below", "Say what to point out"],
  },
};

export function startFor(type: StudioType, c: Controls): Start | null {
  const id = startIdFor(type, c);
  return id ? { id, ...STARTS[id] } : null;
}

/** The start's card line, for Create: "You add: 2 to 6 photos". */
export function needsLine(id: StartId): string {
  const needs = STARTS[id].needs;
  return needs ? `You add: ${needs}` : "Just describe it";
}

/**
 * The one thing a start still needs before Generate, in the server's terms
 * (the same counts `studioJobInput` refuses). Null when nothing is missing.
 */
export function missingFor(type: StudioType, c: Controls): string | null {
  const id = startIdFor(type, c);
  const photos = c.referenceAssetIds?.length ?? 0;
  if (id === "clips" && !c.sourceVideoAssetIds?.length) return "Add at least one clip";
  if (id === "motion-post" && photos < 1) return "Add the picture to move";
  if (id === "slideshow" && photos < 2)
    return photos === 1 ? "Add one more photo" : "Add at least 2 photos";
  if (id === "site" && photos !== 1) return "Pick a page of your website";
  return null;
}

/**
 * Which pickers this start shows on the page instead of in the side panel:
 * what the piece is made from (clips, photos, a website page), the product
 * for a product video, and the goal for an ad. The side panel leaves out
 * whatever is shown here, so nothing appears twice.
 */
export function canvasPickers(
  type: StudioType,
  c: Controls,
): { source: boolean; product: boolean; adObjective: boolean } {
  const id = startIdFor(type, c);
  return {
    source: id === "clips" || id === "slideshow" || id === "site" || id === "motion-post",
    product: id === "product" || id === "video-ad",
    adObjective: type === "ad",
  };
}
