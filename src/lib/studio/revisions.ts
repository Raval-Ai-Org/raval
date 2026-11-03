import type { StudioJobOutput } from "./jobs";

/** Enforce text-only scope in code, rather than trusting the model to retain media. */
export function retainStudioMedia(
  previous: StudioJobOutput,
  revised: StudioJobOutput,
  target: string,
): StudioJobOutput {
  const variants = previous.variants?.map((old) => {
    if (!["captions", "platforms", old.platform].includes(target)) return old;
    return revised.variants?.find((next) => next.platform === old.platform) ?? old;
  });
  return {
    ...previous,
    ...revised,
    ...(variants ? { variants: target === "platforms" ? revised.variants : variants } : {}),
    media: previous.media,
    concept: previous.concept,
    visualConcept: previous.visualConcept,
    altText: previous.altText,
    artwork: previous.artwork,
    storyboard: previous.storyboard,
    visualTaste: previous.visualTaste,
    slides: previous.slides,
    carousel: previous.carousel,
    story: previous.story,
    partial: previous.partial,
    warnings: previous.warnings,
  };
}
