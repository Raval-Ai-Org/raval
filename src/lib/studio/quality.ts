import type { StudioJobOutput, StudioControls } from "./jobs";
import type { StudioType } from "./formats";
import { carouselStoryIssue } from "./carousel/story";
import { storyIssue } from "@/lib/stories/frames";

const ARTICLE_TARGET = { short: 600, standard: 1100, long: 1800 } as const;

/** Fast checks for clearly incomplete drafts. Editorial judgment remains with the user. */
export function studioOutputQualityIssue(
  type: StudioType,
  output: StudioJobOutput,
  controls: StudioControls,
  platformCount: number,
): string | null {
  if (["social", "image", "video", "carousel"].includes(type)) {
    if ((output.variants?.length ?? 0) !== platformCount)
      return "A requested platform caption is missing.";
    if (output.variants?.some((variant) => variant.body.trim().length < 20))
      return "A platform caption has no useful message.";
  }
  if (type === "carousel") {
    if (output.slides?.length !== (controls.slideCount ?? 6))
      return "The carousel has the wrong number of slides.";
    const story = carouselStoryIssue(output.slides);
    if (story) return story;
  }
  if (type === "story") {
    if (output.story?.mode === "video")
      return (output.concept?.trim().length ?? 0) < 60
        ? "The video idea is too vague to render reliably."
        : null;
    return storyIssue(output.story?.frames, controls.frameCount ?? 3);
  }
  if (type === "article") {
    const target = ARTICLE_TARGET[controls.length ?? "standard"];
    if (!output.article || output.article.wordCount < target * 0.6)
      return "The article is substantially shorter than requested.";
    if (!/^##\s+.+/m.test(output.article.markdown))
      return "The article needs descriptive sections.";
  }
  if ((type === "image" || type === "video") && (output.concept?.trim().length ?? 0) < 60)
    return "The visual concept is too vague to render reliably.";
  if (type === "script" && (!output.script?.hook.trim() || !output.script.beats.length))
    return "The video script lacks a usable hook or shot plan.";
  return null;
}
