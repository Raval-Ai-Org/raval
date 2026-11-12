// The code checks on a format script. Pure. A script that fails gets one
// repair pass with these reasons (concepts.server.ts); anything still wrong is
// shown to the person as a warning before they spend on a video.

import { HOOK_TEXT_MAX_WORDS } from "../hook-text";
import type { Script } from "../schemas";
import {
  AD_VOICE,
  BANNED_OPENERS,
  MAX_HOOK_WORDS,
  MAX_LINE_WORDS,
  MAX_PRODUCT_MENTIONS,
  MAX_SHOT_SECONDS,
} from "./craft";
import type { UgcFormat } from "./types";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Times the product is named out loud: its full name, or its distinctive first word. */
export function productMentions(script: Pick<Script, "scenes">, productName: string): number {
  const name = productName.trim();
  if (!name) return 0;
  const spoken = script.scenes.map((s) => s.dialogue).join(" ");
  const full = new RegExp(`\\b${escape(name)}\\b`, "gi");
  const count = spoken.match(full)?.length ?? 0;
  if (count) return count;
  const first = words(name)[0] ?? "";
  if (first.length < 5) return 0;
  return spoken.match(new RegExp(`\\b${escape(first)}\\b`, "gi"))?.length ?? 0;
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

/** A hook that says what an earlier one said (same words, or three quarters of them). */
export function repeatsHook(hook: string, recent: readonly string[]): string | null {
  const a = new Set(tokens(hook));
  if (a.size < 3) return null;
  for (const old of recent) {
    const b = new Set(tokens(old));
    if (b.size < 3) continue;
    const shared = [...a].filter((t) => b.has(t)).length;
    if (shared / Math.min(a.size, b.size) >= 0.75) return old;
  }
  return null;
}

export type ScriptCheckContext = {
  productName: string;
  /** Hooks the brand used lately, newest first. */
  recentHooks?: readonly string[];
};

/** What is wrong with a script for this format, in plain words; [] when it is fine. */
export function formatScriptIssues(
  script: Script,
  format: UgcFormat,
  ctx: ScriptCheckContext,
): string[] {
  const issues: string[] = [];
  const spoken = script.scenes.filter((s) => s.dialogue.trim());
  const first = spoken[0]?.dialogue ?? "";

  if (format.speech === "none" && spoken.length)
    issues.push("Nobody speaks in this format: leave every line of dialogue empty.");
  if (format.speech !== "none" && !spoken.length)
    issues.push("Write the spoken lines: this format is carried by what people say.");

  if (BANNED_OPENERS.some((re) => re.test(script.hook) || re.test(first)))
    issues.push(
      "The opening sounds like an advert (a greeting, 'are you tired of', 'introducing'). Start mid-action with a surprising line.",
    );
  if (first && words(first).length > MAX_HOOK_WORDS && (script.scenes[0]?.end ?? 0) <= 2)
    issues.push(
      `The first line is ${words(first).length} words; the hook must land in 1.5 seconds (${MAX_HOOK_WORDS} words or fewer).`,
    );
  const adWords = script.scenes
    .map((s) => s.dialogue.match(AD_VOICE)?.[0])
    .filter((w): w is string => !!w);
  if (adWords.length)
    issues.push(`"${adWords[0]}" is advert language. Say it the way a person would.`);
  const long = spoken.find((s) => words(s.dialogue).length > MAX_LINE_WORDS);
  if (long)
    issues.push(
      `A line runs ${words(long.dialogue).length} words; keep every spoken line to ${MAX_LINE_WORDS} words or fewer.`,
    );

  const mentions = productMentions(script, ctx.productName);
  if (mentions > MAX_PRODUCT_MENTIONS)
    issues.push(
      `The product is named ${mentions} times; name it at most ${MAX_PRODUCT_MENTIONS} times so it plays as a real video.`,
    );

  // Story shape: a format with a turn or payoff needs one.
  const roles = script.scenes.map((s) => s.role).filter(Boolean);
  if (roles.length) {
    const wants = new Set(format.beats.map((b) => b.role));
    if (
      (wants.has("payoff") || wants.has("turn")) &&
      !roles.some((r) => r === "payoff" || r === "turn")
    )
      issues.push("The script has no turn or payoff: add the twist the video builds to.");
  }

  // Cast: only the format's roles speak, and a two-person format uses both.
  const speakers = new Set(
    script.scenes.filter((s) => s.dialogue.trim()).map((s) => s.speaker ?? "A"),
  );
  const keys = new Set(format.roles.map((r) => r.key));
  if ([...speakers].some((s) => s !== "none" && !keys.has(s as "A" | "B")))
    issues.push("A line is given to someone who isn't in this format.");
  const formatSpeakers = new Set(format.beats.map((b) => b.speaker).filter((s) => s !== "none"));
  if (formatSpeakers.size === 2 && script.scenes.some((s) => s.speaker) && speakers.size < 2)
    issues.push("Both people need a line: this format is a back-and-forth.");

  // People are named by role in actions: the video model doesn't know "A" or "B".
  if (
    script.scenes.some((s) =>
      /(^|[.!?;]\s+)(A|B) (?!few\b|bit\b|lot\b|little\b)[a-z]+s\b/.test(`${s.action} ${s.shot}`),
    )
  )
    issues.push(
      `Name people by their role in the actions (${format.roles.map((r) => r.title.toLowerCase()).join(", ") || "the hands"}), never "A" or "B".`,
    );

  // Rhythm: cut formats keep every shot short.
  if (format.edit === "hard-cuts" || format.edit === "split-open") {
    const slow = script.scenes.find((s) => s.end - s.start > MAX_SHOT_SECONDS);
    if (slow)
      issues.push(
        `A shot runs ${Math.round((slow.end - slow.start) * 10) / 10} seconds; cut every 1.5 to 3 seconds in this format.`,
      );
  }

  if (
    script.onScreen &&
    words(script.onScreen.replace(/\s+\/\s+/, " ")).length > HOOK_TEXT_MAX_WORDS
  )
    issues.push(`The hook text is too long; keep it to ${HOOK_TEXT_MAX_WORDS} words or fewer.`);

  const repeat = repeatsHook(script.hook || first, ctx.recentHooks ?? []);
  if (repeat) issues.push(`The opening repeats an earlier video ("${repeat}"). Open differently.`);

  return issues;
}
