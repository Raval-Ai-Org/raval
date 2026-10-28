// Variations: more versions of a finished picture to choose from. The words
// stay the same; each version tries a different composition, so a person picks
// the best one instead of hoping a single render is right. Pure and
// browser-safe: the runner, billing and the review panel share it.
import type { CreateJobInput, MediaOutput, StudioJob } from "./jobs";

/** Single-picture formats. Carousels and Stories are a series, not one picture. */
export const VARIATION_TYPES = ["image", "ad", "social"] as const;
export const VARIATION_TARGET = "variations";
export const MIN_VARIATIONS = 2;
export const MAX_VARIATIONS = 4;
export const DEFAULT_VARIATIONS = 3;

type Request = Pick<CreateJobInput, "type" | "controls"> &
  Partial<Pick<CreateJobInput, "parentJobId" | "refine">>;

export function isVariationsRequest(input: Request): boolean {
  return Boolean(
    input.parentJobId &&
    input.refine?.target === VARIATION_TARGET &&
    (VARIATION_TYPES as readonly string[]).includes(input.type),
  );
}

export function variationCount(controls: { variationCount?: number } | undefined): number {
  const n = Math.round(controls?.variationCount ?? DEFAULT_VARIATIONS);
  return Math.min(MAX_VARIATIONS, Math.max(MIN_VARIATIONS, Number.isFinite(n) ? n : 3));
}

export const optionSlot = (index: number) => `option:${index}`;
export const isOptionSlot = (slot: string) => slot.startsWith("option:");

/** What makes each version different. The brand, product and words never change. */
const DIRECTIONS = [
  "Move closer: a tighter crop with the subject larger and more detail visible.",
  "Change the setting and light: a different background, time of day and colour mood within the brand palette.",
  "Change the layout: rearrange where the subject and the words sit, with a different camera angle.",
  "Make it bolder: stronger contrast, a simpler background and more empty space around the subject.",
];

export function variationNote(index: number, count: number): string {
  return [
    `This is version ${index + 1} of ${count} of the same piece, made so a person can choose between them.`,
    DIRECTIONS[index % DIRECTIONS.length],
    "Keep the same brand, product, message and exact words as the brief; only the composition and art direction change. Do not copy the composition of the current version.",
  ].join(" ");
}

/** The versions a person can choose between: the current picture first. */
export function pictureChoices(media: MediaOutput[] | undefined): MediaOutput[] {
  const list = media ?? [];
  const main = list.find((m) => m.slot === "main");
  const options = list.filter((m) => isOptionSlot(m.slot));
  return main ? [main, ...options] : options;
}

/** A variations job is charged only for the versions it really made. */
export function variationsCaptured(job: StudioJob, quoted: number): number {
  const requested = variationCount(job.input?.controls);
  const ready = (job.output?.media ?? []).filter(
    (m) => isOptionSlot(m.slot) && m.status === "ready",
  ).length;
  return Math.round((quoted * Math.min(ready, requested)) / requested);
}
