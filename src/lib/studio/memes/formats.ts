// Meme format knowledge: how each kind of joke works, and how to write it.
//
// Distilled from the memegen catalogue and meme-maker's caption rules
// (Round 5, docs/studio/marketing-knowledge.md). The mechanic decides the
// writing; the template only gives it a picture. Pure and browser-safe.
import type { MemeMechanic } from "./types";

export const MECHANIC_RULES: Record<MemeMechanic, string> = {
  comparison:
    "Two or more things side by side: the labels are parallel and short, the difference is the joke.",
  preference:
    "Reject one, choose the other: the rejected option is the usual way, the chosen one the better (or funnier) way; same length, same grammar.",
  escalation:
    "Each panel goes one step further than the last; the final step is absurd but true to the audience.",
  dilemma:
    "Two options the reader can't choose between; both must be real, specific and equally tempting.",
  irony:
    "Say the opposite of what is shown, or show the gap between what people say and do; deadpan.",
  reaction:
    "Label the situation; the face does the punchline. The line names a specific moment, never a general feeling.",
  "self-own": "The person admits their own bad habit; relatable, never mean about the reader.",
  "label-scene":
    "Labels on the people and objects map one situation onto the picture; each label 1-4 words, the mapping must be instant.",
  "plan-fail": "The steps of a plan, the last one undoes it; the first steps sound sensible.",
  "expectation-reality":
    "What people expect vs what really happens; the reality is specific and a little painful.",
  denial: "Someone insists all is fine while the evidence says otherwise; understated.",
  announcement:
    "A bold, confident statement in the character's voice; it works when the claim is specific and slightly too proud.",
  question:
    "A question that reveals an absurd truth about the situation; it must be answerable in the reader's head.",
  other: "Follow the template's own known use exactly.",
};

/**
 * Templates the feed has seen too often (meme-maker's default blacklist,
 * mapped to memegen ids). Allowed, but only when the joke really needs one.
 */
export const FATIGUED_TEMPLATES: ReadonlySet<string> = new Set([
  "drake",
  "db",
  "ds",
  "gru",
  "rollsafe",
  "harold",
  "fine",
  "disastergirl",
  "success",
  "pigeon",
  "panik-kalm-panik",
  "cmm",
  "spongebob",
  "astronaut",
  "both",
]);

/** The craft every meme follows, whichever way it is made. */
export const MEME_CRAFT: readonly string[] = [
  "Start from one true observation about this audience's day (a habit, a frustration, a small win), then pick the format whose mechanic fits it; never start from a template and force a joke in.",
  "The image must carry half the joke: words and picture each do part, so the meme fails if either is removed.",
  "Write like a person in this audience posts: their words and slang, lowercase is fine, no marketing words, no hashtags in the picture.",
  "One strong line per box; the punchline is the last thing read and the shortest.",
  "The brand stays in the background: at most a light, true nod to what it does; the reader's world is the subject.",
  "Never punch down, never mock a group, a body, a religion, politics or a tragedy; nothing about a real person beyond the template's known use.",
];
