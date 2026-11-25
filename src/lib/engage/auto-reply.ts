// Inbox auto-reply: the pure half. Mox reads each new comment and proposes
// one of four things; this file decides what actually happens.
//
//   reply   the answer is in what the team taught (or needs no facts): sent
//           by itself, within the hourly cap, if the figure check kept it whole.
//   ask     a fact is missing (price, stock, hours…): nothing is sent, the
//           comment waits and the team is asked once (one open question per
//           fingerprint). Their answer is kept and the comments are answered.
//   person  a complaint, a refund, anything sensitive: waits for a person,
//           with Mox's draft ready.
//   skip    spam or nothing to answer: left alone.
export type AutoAction = "reply" | "ask" | "person" | "skip";

export type AutoDecision = {
  action: AutoAction;
  reply: string | null;
  question: string | null;
  why: string | null;
};

/** Model calls one sweep may make for one brand; the rest wait for the next sweep. */
export const AUTO_REPLY_PER_RUN = 20;
/** The team's standing instructions, in characters. */
export const MAX_GUIDELINES = 3_000;
/** Open questions shown at once. */
export const MAX_OPEN_QUESTIONS = 20;

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Read what the model returned; anything unclear waits for a person. */
export function parseDecision(raw: unknown): AutoDecision {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const action = (["reply", "ask", "person", "skip"] as const).find((a) => a === o.action);
  const reply = clean(o.reply, 2_200) || null;
  const question = clean(o.question, 300) || null;
  const why = clean(o.why, 200) || null;
  if (action === "reply" && !reply) return { action: "person", reply: null, question, why };
  if (action === "ask" && !question) return { action: "person", reply, question: null, why };
  return { action: action ?? "person", reply, question, why };
}

/**
 * The same question asked in other words shares one row: lower case, no
 * punctuation, no filler words, words sorted.
 */
export function questionFingerprint(question: string): string {
  const FILLER = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "do",
    "does",
    "you",
    "your",
    "we",
    "our",
    "what",
    "whats",
    "how",
    "much",
    "of",
    "for",
    "to",
    "in",
    "on",
    "it",
    "this",
    "that",
    "and",
    "or",
    "please",
    "can",
    "i",
    "there",
    "any",
  ]);
  const words = question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
  const key = [...new Set(words)].sort().join(" ").slice(0, 200);
  return key || question.toLowerCase().trim().slice(0, 200) || "question";
}

export function tidyGuidelines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_GUIDELINES);
}

/** Add one instruction to the team's list, skipping one already there. */
export function addGuideline(current: string, line: string): string {
  const next = clean(line, 500);
  if (!next) return tidyGuidelines(current);
  const lines = tidyGuidelines(current).split("\n").filter(Boolean);
  if (lines.some((l) => l.toLowerCase() === next.toLowerCase())) return lines.join("\n");
  return tidyGuidelines([...lines, next].join("\n"));
}

export type AutoOutcome =
  | { kind: "send"; text: string }
  | { kind: "ask"; question: string; draft: string | null }
  | { kind: "hold"; draft: string | null; note: string }
  | { kind: "skip"; note: string };

/**
 * What happens to one comment. `finished` is the reply after the figure and
 * link checks (`finishEngageReply`); `removed` means a figure the brand never
 * gave was cut, so it is not sent by itself.
 */
export function autoOutcome(
  decision: AutoDecision,
  finished: { text: string; removed: number | boolean } | null,
): AutoOutcome {
  if (decision.action === "skip")
    return { kind: "skip", note: decision.why ?? "Nothing to answer." };
  if (decision.action === "ask" && decision.question)
    return { kind: "ask", question: decision.question, draft: null };
  if (decision.action === "reply" && finished?.text && !finished.removed)
    return { kind: "send", text: finished.text };
  if (decision.action === "reply" && finished?.removed)
    return {
      kind: "hold",
      draft: finished.text || null,
      note: "Mox left out a figure your brand never gave. Check it and send.",
    };
  return {
    kind: "hold",
    draft: finished?.text || null,
    note: decision.why ?? "Mox thinks a person should answer this one.",
  };
}

/** One plain line for the Inbox and chat about what auto-reply did. */
export function autoNote(state: "replied" | "waiting_info" | "needs_person" | "skipped"): string {
  return {
    replied: "Mox replied",
    waiting_info: "Waiting for your answer",
    needs_person: "Needs you",
    skipped: "Skipped",
  }[state];
}
