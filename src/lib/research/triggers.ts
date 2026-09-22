// triggers.ts — when is a web search actually worth it?
//
// The expensive mistake with a research API is calling it on every turn. Most
// of what people ask Mellox is about their own business, their own content or
// their own numbers, and Mellox already holds all of that: a search would cost
// money and add nothing.
//
// So the gate is deliberately conservative and deliberately cheap — pure
// string work, no model call to decide whether to make a model call. It looks
// for the two things that genuinely need the outside world: a question about
// something Mellox does not hold (a company, a market, a person), and a
// demand for currency (now, latest, this year, what changed).
//
// False negatives are fine: the answer is simply ungrounded, exactly as it was
// before this existed. False positives cost money on every message, so the
// rules err towards not searching.

/** Words that mean "as it is now", not "as it was when the model was trained". */
const RECENCY = [
  "latest",
  "recent",
  "recently",
  "current",
  "currently",
  "right now",
  "today",
  "this week",
  "this month",
  "this year",
  "these days",
  "up to date",
  "up-to-date",
  "news",
  "announced",
  "just launched",
  "new release",
  "changed",
  "changing",
  "trend",
  "trends",
  "trending",
  "emerging",
  "upcoming",
  "nowadays",
];

/** Subjects that live outside Mellox's own data. */
const EXTERNAL = [
  "competitor",
  "competitors",
  "competing",
  "alternative to",
  "alternatives to",
  "market",
  "industry",
  "landscape",
  "benchmark",
  "benchmarks",
  "statistic",
  "statistics",
  "stats",
  "study",
  "studies",
  "research shows",
  "according to",
  "who is",
  "who are",
  "what is happening",
  "regulation",
  "regulations",
  "compliance",
  "pricing of",
  "funding",
  "acquired",
  "acquisition",
  "launch",
  "launched",
  "case study",
  "best practices",
  "source",
  "sources",
  "cite",
  "citation",
];

/** An explicit ask. These alone are enough. */
const EXPLICIT = [
  "search the web",
  "search online",
  "look it up",
  "look up",
  "google it",
  "find sources",
  "with sources",
  "cite your sources",
  "do some research",
  "research this",
  "check online",
  "what do people say",
];

/** Things Mellox already holds: asking about them must never trigger a search. */
const INTERNAL_ONLY = [
  "my brand dna",
  "our brand dna",
  "my calendar",
  "our calendar",
  "my drafts",
  "our drafts",
  "my posts",
  "our posts",
  "my analytics",
  "our analytics",
  "my schedule",
  "our schedule",
  "this draft",
  "rewrite",
  "make it shorter",
  "make it longer",
  "shorten",
  "translate",
  "fix the grammar",
  "change the tone",
];

const CURRENT_YEAR = new Date().getFullYear();

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export type ResearchDecision = {
  /** Whether to spend a search on this. */
  research: boolean;
  /** The query to run, when research is true. */
  query: string;
  /** Why — for logs and for the activity a user can see. */
  reason: "explicit" | "recency" | "external-question" | "none";
};

/**
 * Decide whether a chat message needs live web information.
 *
 * Requires either an explicit ask, or BOTH an external subject and a reason to
 * think today's answer differs from a general one. One signal on its own is
 * not enough: "who is my audience" is external but about their own business,
 * and "shorten this" mentions nothing external at all.
 */
export function decideChatResearch(message: string): ResearchDecision {
  const text = message.toLowerCase().trim();
  if (text.length < 12) return { research: false, query: "", reason: "none" };

  const query = message.trim().slice(0, 300);

  if (includesAny(text, EXPLICIT)) {
    return { research: true, query, reason: "explicit" };
  }

  // An instruction about text the user already has is never research, whatever
  // else it happens to mention.
  if (includesAny(text, INTERNAL_ONLY)) {
    return { research: false, query: "", reason: "none" };
  }

  const external = includesAny(text, EXTERNAL);
  const recent =
    includesAny(text, RECENCY) ||
    text.includes(String(CURRENT_YEAR)) ||
    text.includes(String(CURRENT_YEAR + 1));

  if (external && recent) return { research: true, query, reason: "recency" };

  // A question about a named outside thing, asked as a question, is worth one
  // search even without a recency word — "what is X", "how does Y price".
  const isQuestion =
    text.includes("?") || /^(what|who|which|how|when|where|why|is|are|does|do)\b/.test(text);
  if (external && isQuestion) return { research: true, query, reason: "external-question" };

  return { research: false, query: "", reason: "none" };
}

/**
 * Should a content brief be researched before it is written? Same posture as
 * the chat gate, tuned for Studio: a factual or market-based piece benefits
 * from current sources; a caption, a hook or a visual idea does not, and
 * searching for one would only slow it down.
 */
export function briefNeedsResearch(brief: string): boolean {
  const text = brief.toLowerCase().trim();
  if (text.length < 20) return false;
  if (includesAny(text, INTERNAL_ONLY)) return false;

  const factual = includesAny(text, [
    "statistic",
    "statistics",
    "stats",
    "data",
    "study",
    "studies",
    "report",
    "research",
    "trend",
    "trends",
    "industry",
    "market",
    "competitor",
    "competitors",
    "news",
    "case study",
    "benchmark",
    "guide to",
    "explainer",
    "comparison",
    " vs ",
    "versus",
    "why is",
    "how does",
    "state of",
    "predictions",
    "forecast",
  ]);
  const current =
    includesAny(text, RECENCY) ||
    text.includes(String(CURRENT_YEAR)) ||
    text.includes(String(CURRENT_YEAR + 1));

  // A factual topic is worth research on its own — a "state of the industry"
  // piece written from memory is exactly the kind of content that ages badly.
  return factual || current;
}
