// The writing rules every Creator video follows, whatever its format. Pure.
//
// The script writer reads `craftRules`; `formatScriptIssues` (checks.ts)
// refuses a script that breaks the ones code can see. Add a rule here, never
// in one prompt only.

import type { UgcFormat } from "./types";

/** Openers that make a video read as an ad in the first second. */
export const BANNED_OPENERS: readonly RegExp[] = [
  /^\s*(hey|hi|hello)[,!]?\s+(guys|everyone|everybody|y'?all|friends|there)\b/i,
  /^\s*(hi|hey|hello)[,!]?\s+(i'?m|my name is)\b/i,
  /\bare you tired of\b/i,
  /^\s*introducing\b/i,
  /\bgame[- ]?changer\b/i,
  /\byou need this\b/i,
  /^\s*do you (ever )?struggle with\b/i,
  /^\s*(say goodbye to|meet your new)\b/i,
  /^\s*(attention|listen up)\b/i,
];

/** Words that sound like an advert, not a person. */
export const AD_VOICE =
  /\b(revolutionary|must[- ]have|game[- ]?changer|limited time|act now|don'?t miss out|best[- ]in[- ]class|unlock your|elevate your|level up your|seamless(ly)?|cutting[- ]edge|state[- ]of[- ]the[- ]art|world[- ]class|transform your life)\b/i;

/** The longest spoken line, in words: people talk in short lines. */
export const MAX_LINE_WORDS = 16;
/** The hook line, in words: it has to land inside 1.5 seconds. */
export const MAX_HOOK_WORDS = 12;
/** How often the product is named out loud. More reads as an ad. */
export const MAX_PRODUCT_MENTIONS = 2;
/** The longest shot in a cut format, in seconds. */
export const MAX_SHOT_SECONDS = 5;

const OBJECTIVE_ENDINGS: Record<string, string> = {
  sales:
    "End on the payoff, not a pitch. At most one natural line such as 'link's in my bio' or 'I'll leave it in my bio', said like a person, never 'shop now'.",
  conversion: "End on the payoff. At most one natural line about trying it, never 'sign up today'.",
  app_install: "End on the payoff. At most one natural line about the app, never 'download now'.",
  lead_gen: "End on the payoff. At most one natural line such as 'DM me if you want the list'.",
  awareness: "End on the payoff and the punchline. No call to action is spoken.",
  engagement:
    "End on the payoff, or on a real question people will want to answer. No 'comment below'.",
};

/** The rules the script writer follows for this format. */
export function craftRules(format: UgcFormat, objective: string): string[] {
  const cuts =
    format.edit === "hard-cuts" || format.edit === "split-open"
      ? "Cut every 1.5 to 3 seconds; no shot longer than 5 seconds; no dead air."
      : format.edit === "montage"
        ? "Clips of 1 to 1.5 seconds; the voiceover runs across them."
        : format.edit === "jump-cuts"
          ? "Jump cuts in the same framing remove every pause."
          : "One take: let small natural pauses breathe, but never ramble.";
  return [
    "This is a real creator's Reel that happens to feature the product, never an advert. If it would look normal as a TV ad, it is wrong.",
    `The hook lands inside 1.5 seconds: the first line is ${MAX_HOOK_WORDS} words or fewer, said mid-action, a pattern interrupt (a surprising take, a question, a confession, a visual already happening). Never start with a greeting, a name, "are you tired of", "introducing" or a product name.`,
    "Every video has a story shape: hook, a setup the viewer recognises, a turn at about two thirds, and a payoff line people would repeat. The best payoffs are a twist, a reversal, a deadpan line or a small physical reaction.",
    `The product is the answer, never the subject: it enters at the turn or the payoff, used the way a real person would use it. Name it out loud at most ${MAX_PRODUCT_MENTIONS} times, ideally once or not at all.`,
    `Write lines to be spoken: contractions, plain words, fragments, a cut-off word or an interruption, ${MAX_LINE_WORDS} words or fewer per line. No marketing words (revolutionary, must-have, game changer, unlock, elevate, seamless).`,
    cuts,
    format.roles.length === 2
      ? "Two people: give them opposite energies (animated vs deadpan, sure vs sceptical). Each line answers the last one."
      : format.roles.length === 0
        ? "No one speaks: the story is told by the hands and the sounds alone."
        : "One person: talk to the lens like to one friend, not to an audience.",
    format.roles.length
      ? `In actions and shots, call people by their role (${format.roles.map((r) => r.title.toLowerCase()).join(", ")}), never "A", "B", he or she: the person who plays each role is picked later.`
      : "In actions and shots, describe only the hands and the product.",
    OBJECTIVE_ENDINGS[objective] ?? OBJECTIVE_ENDINGS.awareness,
    "The hook text on screen is a different, shorter line than the spoken hook (8 words or fewer, lower-case is fine): it teases the payoff without giving it away.",
    "The post caption is one or two short lines in the creator's own voice (a reaction, a question or a tease), then 3 to 5 hashtags. No hashtag soup, no 'link in bio' unless the objective is sales.",
  ];
}
