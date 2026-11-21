// brief-fit.ts — the free check that a written post still says what the
// person asked for (pure). A failure gets one rewrite on the stronger writer
// with these reasons (route `studio.plan.escalate`, ADR-0051).
import { contentWords, type BriefRead } from "./brief-read";

/** Most words a headline set in a picture may have (preflight and prompt share it). */
export const HEADLINE_MAX_WORDS = 8;

export type BriefFitInput = {
  read: BriefRead;
  /** The words set in the picture (headline). */
  headline?: string | null;
  /** Supporting lines set in the picture. */
  lines?: string[] | null;
  /** The picture's art direction. */
  visual?: string | null;
  /** Text the facts may also come from (Brand DNA, the product's facts). */
  knownFacts?: string;
};

const NUMBER = /\d[\d,.]*/g;

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Light stemming so "hiring" meets "hire" and "designers" meets "designer". */
function stem(word: string): string {
  return word
    .replace(/(?:ing|ers|er|ed|es|s)$/u, "")
    .replace(/(.)\1$/u, "$1")
    .slice(0, 8);
}

/** Every reason the copy drifts from the brief; empty when it fits. */
export function briefFitIssues(input: BriefFitInput): string[] {
  const issues: string[] = [];
  const headline = (input.headline ?? "").trim();
  const lines = (input.lines ?? []).map((l) => l.replace(/^[a-z]+:\s*/i, "").trim());
  const copy = [headline, ...lines].join(" \n ");

  if (words(headline) > HEADLINE_MAX_WORDS)
    issues.push(
      `The headline has ${words(headline)} words; keep it to ${HEADLINE_MAX_WORDS} or fewer.`,
    );

  // On subject: the headline, the lines or the picture share the brief's words.
  const terms = new Set(input.read.keyTerms.map(stem));
  if (terms.size) {
    const said = new Set(contentWords(`${copy} ${input.visual ?? ""}`).map(stem));
    const shared = [...terms].filter((t) => said.has(t));
    if (!shared.length)
      issues.push(
        `The post drifted from the brief: neither the words nor the picture mention ${input.read.keyTerms
          .slice(0, 4)
          .join(", ")}. Make it about what the person asked for.`,
      );
  }

  // Every figure on the picture comes from the brief or the known facts.
  const allowed = `${input.read.facts.join(" ")} ${input.read.quoted.join(" ")} ${input.knownFacts ?? ""}`;
  const allowedNumbers = new Set((allowed.match(NUMBER) ?? []).map((n) => n.replace(/[,.]$/, "")));
  const invented = (copy.match(NUMBER) ?? [])
    .map((n) => n.replace(/[,.]$/, ""))
    .filter((n) => !allowedNumbers.has(n));
  if (invented.length)
    issues.push(
      `These figures are not in the brief or the brand's facts: ${[...new Set(invented)].join(", ")}. Remove them.`,
    );

  // The person's quoted words are kept.
  for (const quote of input.read.quoted) {
    if (
      quote.split(/\s+/).length <= HEADLINE_MAX_WORDS &&
      !copy.toLowerCase().includes(quote.toLowerCase())
    )
      issues.push(`Use the person's exact words ${JSON.stringify(quote)} on the picture.`);
  }
  return issues;
}
