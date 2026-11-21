import "server-only";
// Memes on real templates (ADR-0047): the picture for a classic meme is the
// template itself; a remix asks the image model to redraw the template's scene
// in the brand's world with no words, and code draws the words on both.
import type { StudioJobOutput } from "@/lib/studio/jobs";
import { memeLineIssues, memeMode, memeTemplate } from "@/lib/studio/memes/select";
import type { MemeTemplate } from "@/lib/studio/memes/types";
import { fitImagePrompt } from "@/lib/studio/image-prompt-fit";
import { drawMeme, memeTemplatePicture, memeTextDrawable } from "./render.server";

/** What a meme task carries so its words are drawn once the picture is back. */
export type MemeTask = { templateId: string; lines: string[] };

/** Why a template meme's answer can't be used as written (null when fine). */
export function memeConceptIssue(output: StudioJobOutput): string | null {
  const mode = memeMode(output.memeMode);
  if (mode !== "classic" && mode !== "remix") return null;
  const template = memeTemplate(output.memeFormat);
  if (!template)
    return `"${output.memeFormat ?? ""}" is not one of the listed templates; pick an id from the list or make it "original".`;
  const issues = memeLineIssues(template, output.onImageLines ?? []);
  if (mode === "remix" && template.person)
    issues.push(`"${template.id}" shows a real person: make it "classic", never a remix.`);
  return issues.length ? `The meme's words don't fit: ${issues.join(" ")}` : null;
}

/** The template picture as a data URL for the image model (null when missing). */
export async function memeTemplateDataUrl(template: MemeTemplate): Promise<string | null> {
  const picture = await memeTemplatePicture(template);
  return picture ? `data:image/jpeg;base64,${picture.toString("base64")}` : null;
}

/** The canvas the remix is drawn on: the one closest to the template's shape. */
export function memeRemixSize(template: MemeTemplate): "1024x1024" | "1792x1024" | "1024x1792" {
  const r = template.w / Math.max(1, template.h);
  return r > 1.35 ? "1792x1024" : r < 0.74 ? "1024x1792" : "1024x1024";
}

/** The image prompt for a remix: the template's scene, redrawn in the brand's world, no words. */
export function memeRemixPrompt(args: {
  template: MemeTemplate;
  concept: string;
  brandName: string;
  palette: string[];
}): string {
  const boxes = args.template.boxes
    .map(
      ([x, y, w, h], i) =>
        `box ${i + 1} at ${Math.round(x * 100)}% from left, ${Math.round(y * 100)}% from top, ${Math.round(w * 100)}% wide, ${Math.round(h * 100)}% high`,
    )
    .join("; ");
  return fitImagePrompt({
    must: [
      `Redraw the attached meme picture ("${args.template.name}") as a new picture: keep its exact composition, framing, number of panels, poses, gestures and facial expressions, so anyone who knows the meme recognises it at a glance.`,
      "Absolutely no words, letters, numbers, captions, watermarks or logos anywhere in the picture: the meme's words are added afterwards in these areas, so keep them calm and readable: " +
        boxes +
        ".",
      "Every person is a new, fictional person in the same pose and expression, never the original person's face.",
    ],
    body: [
      `Change for ${args.brandName}: ${args.concept}`,
      args.palette.length
        ? `Use the brand's colours where the scene allows: ${args.palette.slice(0, 5).join(", ")}.`
        : "",
      "Style: the same kind of picture as the original (photo stays photo, cartoon stays cartoon), natural light, no polish an ad would add.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

/** The finished classic meme (template + words), or null to make it another way. */
export async function classicMemePicture(output: StudioJobOutput): Promise<Buffer | null> {
  const template = memeTemplate(output.memeFormat);
  const lines = output.onImageLines ?? [];
  if (!template || !memeTextDrawable(lines)) return null;
  const picture = await memeTemplatePicture(template);
  return picture ? drawMeme({ picture, template, lines }) : null;
}

/** The words drawn on a finished remix (null when they can't be). */
export async function finishMemeRemix(dataUrl: string, task: MemeTask): Promise<Buffer | null> {
  const template = memeTemplate(task.templateId);
  if (!template) return null;
  const picture = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  return drawMeme({ picture, template, lines: task.lines });
}

/** A layout for an original scene with the same number of lines, when a template can't be drawn. */
export function fallbackMemeLayout(lineCount: number): string {
  return lineCount >= 3 ? "text-thread" : lineCount === 2 ? "top-bottom" : "pov";
}
