// training.ts — what the team taught Mox about answering comments. Pure.
//
// Two kinds of teaching:
//   * answers: "Do you ship to Canada?" → "Yes, in 5–7 days". They are facts:
//     a figure in an answer may be repeated in a reply;
//   * examples: replies a person actually sent. They show the voice only,
//     never facts, and only the newest few reach a prompt.
// Both are capped so a prompt never grows without limit.

export type EngageAnswer = { id: string; question: string; answer: string; updatedAt: string };
export type EngageExample = {
  id: string;
  platform: "instagram" | "facebook";
  comment: string;
  reply: string;
  createdAt: string;
};

export const MAX_ANSWERS = 100;
export const KEEP_EXAMPLES = 50;
const ANSWERS_CHARS = 4_000;
const EXAMPLES_IN_PROMPT = 6;

export function tidyAnswer(
  question: unknown,
  answer: unknown,
): { ok: true; question: string; answer: string } | { ok: false; reason: string } {
  const q = typeof question === "string" ? question.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const a = typeof answer === "string" ? answer.replace(/\r/g, "").trim().slice(0, 1500) : "";
  if (!q) return { ok: false, reason: "Write what people ask." };
  if (!a) return { ok: false, reason: "Write the answer." };
  return { ok: true, question: q, answer: a };
}

/** The answers block for the prompt, newest first, within a fixed size. */
export function answersBlock(answers: readonly EngageAnswer[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const a of answers) {
    const line = `- Q: ${a.question}\n  A: ${a.answer}`;
    if (used + line.length > ANSWERS_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

/** The answers as plain facts, for the figure check. */
export function answersFacts(answers: readonly EngageAnswer[]): string {
  return answers.map((a) => `${a.question} ${a.answer}`).join("\n");
}

/** A few recent replies on the same network first, then any. */
export function examplesBlock(
  examples: readonly EngageExample[],
  platform: "instagram" | "facebook",
): string {
  const same = examples.filter((e) => e.platform === platform);
  const rest = examples.filter((e) => e.platform !== platform);
  return [...same, ...rest]
    .slice(0, EXAMPLES_IN_PROMPT)
    .map((e) => `Comment: ${e.comment.slice(0, 300)}\nReply: ${e.reply.slice(0, 400)}`)
    .join("\n\n");
}

/** Is a sent reply worth keeping as an example? Short thanks teach little. */
export function worthKeeping(reply: string): boolean {
  const words = reply.trim().split(/\s+/).filter(Boolean).length;
  return words >= 4;
}
