// The opening of a Studio video: the first second that decides whether
// anyone keeps watching. Pure and browser-safe. One opening per video, picked
// by code so the brand's videos don't all open the same way: the last two
// openings are skipped, then the job id picks among what fits, so a retry of
// the same job keeps its opening. Ids are stored (`meta.video_hook`): add,
// never rename.

import type { PeopleRule, VideoKindId } from "./kinds";

export type VideoHook = {
  id: string;
  label: string;
  /** The direction the storyboard follows for its first shot. */
  direction: string;
  /** Needs hands on screen. */
  hands?: boolean;
  /** Only for these kinds; absent: any kind that isn't excluded. */
  kinds?: readonly VideoKindId[];
  /** Never for these kinds. */
  not?: readonly VideoKindId[];
};

export const VIDEO_HOOKS: readonly VideoHook[] = [
  {
    id: "satisfying",
    label: "Satisfying moment",
    direction:
      "Open on the most satisfying moment the product offers: a pour, a peel, a click, a perfect fit, a press. The kind of second people replay.",
    not: ["brand-story", "before-after"],
  },
  {
    id: "macro-reveal",
    label: "Too close to tell",
    direction:
      "Open so close on a texture or detail that nobody can tell what it is yet; the camera pulls back and the product is revealed.",
    not: ["brand-story", "how-it-works"],
  },
  {
    id: "payoff-first",
    label: "Result first",
    direction:
      "Show the finished result or the best moment in the first second, then go back to how it got there. The viewer stays to see how.",
    kinds: ["how-it-works", "product-demo", "before-after", "brand-story", "product-showcase"],
  },
  {
    id: "motion-in",
    label: "Something moves in",
    direction:
      "Open on a strong, natural motion into the frame: the product lands, slides, spins or is set down, water or light sweeps across it.",
    not: ["brand-story", "living-picture"],
  },
  {
    id: "pov",
    label: "Your own hands",
    direction:
      "First-person view: the viewer's own hands reach for the product and start using it, as if they were holding it.",
    hands: true,
    kinds: ["product-demo", "product-showcase", "how-it-works", "broll-hook", "offer-teaser"],
  },
  {
    id: "contrast",
    label: "Problem, then answer",
    direction:
      "One beat of the small, familiar problem the brand solves, then a hard cut to the brand's answer already working.",
    kinds: ["brand-story", "before-after", "product-demo", "offer-teaser"],
  },
  {
    id: "seamless-loop",
    label: "Endless loop",
    direction:
      "Plan the first and last frames as the same frame, so the video replays without a seam and people watch it twice.",
    kinds: ["product-motion", "mood-broll", "broll-hook", "product-showcase", "living-picture"],
  },
  {
    id: "light-sweep",
    label: "Light reveals it",
    direction:
      "Open in near darkness; a sweep of light crosses the frame and reveals the product's shape and finish.",
    kinds: ["product-motion", "product-showcase", "broll-hook", "mood-broll"],
  },
];

const BY_ID = new Map(VIDEO_HOOKS.map((hook) => [hook.id, hook]));

export function videoHook(id: string | null | undefined): VideoHook | null {
  return (id && BY_ID.get(id)) || null;
}

/** Openings that fit a kind and who may be on screen. */
export function hooksFor(kind: VideoKindId, people: PeopleRule): VideoHook[] {
  return VIDEO_HOOKS.filter(
    (hook) =>
      (!hook.kinds || hook.kinds.includes(kind)) &&
      !hook.not?.includes(kind) &&
      !(hook.hands && (people === "none" || people === "source")),
  );
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The opening for a new video: one that fits, skipping the brand's last two
 * openings while anything else fits; `seed` (the job id) picks among the rest.
 */
export function pickVideoHook(
  kind: VideoKindId,
  people: PeopleRule,
  recent: readonly (string | null | undefined)[],
  seed: string,
): VideoHook | null {
  const fitting = hooksFor(kind, people);
  if (!fitting.length) return null;
  const skip = new Set(recent.filter(Boolean).slice(0, 2));
  const fresh = fitting.filter((hook) => !skip.has(hook.id));
  const pool = fresh.length ? fresh : fitting;
  return pool[hash(seed) % pool.length];
}
