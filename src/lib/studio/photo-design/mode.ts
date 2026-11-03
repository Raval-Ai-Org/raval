// Which way a piece uses the person's own photos, decided once before pricing
// so the charge matches what runs. "Post as is" stays exactly that; asking for
// words or design elements on it, a picture edit or more versions means
// designing with the photo (the photo itself is still never redrawn). Pure.
import type { CreateJobInput } from "../jobs";
import { isVariationsRequest } from "../variations";

/** Studio types that make one picture, where a design can hold the photos. */
export const PHOTO_DESIGN_TYPES = ["social", "image", "ad"] as const;

export function isPhotoDesignType(type: string): boolean {
  return (PHOTO_DESIGN_TYPES as readonly string[]).includes(type);
}

const DESIGN_ASK =
  /\b(?:add|put|place|overlay|write|include|design|make|turn|create)\b.{0,60}\b(?:text|words?|headline|title|tagline|badges?|banners?|frames?|borders?|stickers?|elements?|graphics?|shapes?|ribbons?|poster|flyer|collage|design|layout)\b/i;
/** A caption is the post's own text unless it is asked for on the picture. */
const CAPTION_ON_PHOTO = /\bcaptions?\b.{0,30}\bon (?:it|this|the (?:photo|picture|image))\b/i;
const DESIGN_IT =
  /\b(?:design|decorate|brand)\s+(?:it|this|these|them|the (?:photo|picture|image)s?)\b/i;

/**
 * The brief asks for something drawn on or around the photo. The logo alone
 * isn't: the real logo is placed by code on a photo posted as is.
 */
export function asksForDesign(brief: string): boolean {
  return DESIGN_ASK.test(brief) || CAPTION_ON_PHOTO.test(brief) || DESIGN_IT.test(brief);
}

/** How many photos a piece takes in each mode. */
export function photoLimit(mode: string | undefined, type: string): number {
  if (mode === "design" && isPhotoDesignType(type)) return 6;
  if ((mode ?? "preserve") === "preserve" && isPhotoDesignType(type)) return 1;
  return 4;
}

/** The modes a Studio type offers, in plain words. */
export function photoModeOptions(type: string) {
  const design = isPhotoDesignType(type);
  return [
    ...(design
      ? [
          {
            value: "design" as const,
            label: "Design with them",
            hint: "Words and design around your photos",
          },
        ]
      : []),
    { value: "preserve" as const, label: "Post as is", hint: "One photo, unchanged" },
    { value: "edit" as const, label: "Edit details", hint: "Only what you ask to change" },
    { value: "inspire" as const, label: "Inspiration", hint: "Something new in this style" },
  ];
}

type ModeInput = Pick<CreateJobInput, "type" | "controls" | "intent"> &
  Partial<Pick<CreateJobInput, "refine" | "parentJobId">>;

export function resolvePhotoMode(input: ModeInput): CreateJobInput["controls"]["referenceMode"] {
  const mode = input.controls.referenceMode;
  if (!input.controls.referenceAssetIds?.length) return mode;
  if (!isPhotoDesignType(input.type)) return mode === "design" ? "edit" : mode;
  if ((mode ?? "preserve") !== "preserve") return mode;
  const pictureEdit =
    !!input.parentJobId &&
    (input.refine?.target === "media" ||
      isVariationsRequest({ ...input, parentJobId: input.parentJobId }));
  // A website showcase always puts the screen in a designed device.
  const showcase = input.intent.template === "image-website-showcase";
  return pictureEdit || showcase || asksForDesign(input.intent.brief) ? "design" : mode;
}

/** The same request with its photo mode settled (for pricing and running). */
export function withResolvedPhotoMode<T extends ModeInput>(input: T): T {
  const referenceMode = resolvePhotoMode(input);
  return referenceMode === input.controls.referenceMode
    ? input
    : { ...input, controls: { ...input.controls, referenceMode } };
}
