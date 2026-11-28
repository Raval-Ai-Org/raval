// customer-voice.ts — what the brand's own customers ask and get stuck on,
// read from the Inbox (comments, DMs and the questions Mox asked the team).
// It feeds the brains: Studio's context, Autopilot's plan (as Market entries
// it can point at) and the Home card. Pure string work, no model call.
//
// Honest by construction: a theme is only what people really wrote. A
// question counts once per person who asked (asked_count). Nothing here is
// an answer unless the team gave it (TEAM ANSWERS); a post may answer a
// question only with that answer.

export type VoiceQuestion = {
  question: string;
  askedCount: number;
  status: "open" | "answered" | "dismissed";
  answer: string | null;
};

export type VoiceComment = {
  body: string;
  kind: "comment" | "dm";
  moxState: string;
};

export type CustomerVoice = {
  /** Questions people asked, most asked first. */
  asked: { question: string; count: number; answer: string | null }[];
  /** People's own words where they were confused or unsure. */
  confused: string[];
  /** People who needed a person (complaints, problems), counted only. */
  problems: number;
  /** How many comments and DMs this was read from. */
  read: number;
};

/** Words people use when something isn't clear to them (several languages). */
const CONFUSED =
  /\b(confus\w*|don'?t (get|understand)|not sure|unclear|how (do|does|can|to)|what does|which one|difference between|is it (true|real|safe)|kaise|kya hai|samajh)\b/i;

const clean = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
};

/** Two lines are the same theme when their words mostly overlap. */
function sameTheme(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size) >= 0.6;
}

export function customerVoice(
  questions: readonly VoiceQuestion[],
  comments: readonly VoiceComment[],
  limits = { asked: 6, confused: 4 },
): CustomerVoice {
  const asked = questions
    .filter((q) => q.status !== "dismissed" && q.question.trim())
    .sort((a, b) => b.askedCount - a.askedCount)
    .slice(0, limits.asked)
    .map((q) => ({
      question: clean(q.question, 160),
      count: Math.max(1, q.askedCount),
      answer: q.status === "answered" && q.answer?.trim() ? clean(q.answer, 240) : null,
    }));

  const confused: string[] = [];
  for (const c of comments) {
    if (confused.length >= limits.confused) break;
    const body = c.body.trim();
    if (body.length < 12 || !CONFUSED.test(body)) continue;
    const line = clean(body, 160);
    if (confused.some((x) => sameTheme(x, line))) continue;
    if (asked.some((q) => sameTheme(q.question, line))) continue;
    confused.push(line);
  }

  return {
    asked,
    confused,
    problems: comments.filter((c) => c.moxState === "needs_person").length,
    read: comments.length,
  };
}

/** The block generators read. "" when customers haven't said anything useful yet. */
export function customerVoiceBlock(voice: CustomerVoice): string {
  if (!voice.asked.length && !voice.confused.length) return "";
  const lines = [
    "## What the brand's customers ask (their own comments and DMs, last 60 days)",
    "Real questions and doubts from real customers. A post that answers one, clears up a confusion or shows how something works is welcome. Answer only with the team's answer shown here; never invent one.",
    ...voice.asked.map(
      (q) =>
        `- Asked by ${q.count} ${q.count === 1 ? "person" : "people"}: ${q.question}${q.answer ? ` Team's answer: ${q.answer}` : " (no answer from the team yet: don't state one)"}`,
    ),
    ...voice.confused.map((c) => `- Unsure: "${c}"`),
  ];
  return lines.join("\n");
}
