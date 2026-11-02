// reply.ts — the rules every reply draft follows. Pure.
//
// The model writes a draft (route community.reply); this decides what the
// person is shown:
//   * a sentence with a figure the brand never gave is left out;
//   * links other than the brand's own site are removed;
//   * a reply that names the brand says the writer works there;
//   * it fits the community (Quora answers can be longer than a Reddit comment).
// Mellox never posts it. The person copies it and posts it themselves.
import { withoutUnknownFacts } from "@/lib/autopilot/brief";
import type { CommunitySource } from "./contracts";
import { mentions } from "./signals";

export const MAX_REPLY_CHARS: Record<CommunitySource, number> = {
  reddit: 1_400,
  quora: 2_400,
  hackernews: 1_200,
  stackexchange: 2_400,
};

/** Phrases that already tell readers who wrote it. */
const DISCLOSURE_RE =
  /\b(i|we)\s+(work|am|are)\s+(at|on|for|with)\b|\b(full\s+)?disclosure\b|\b(i'm|i am)\s+(the\s+)?(founder|co-?founder|owner|part of)\b|\bour (team|company|product)\b/i;

export function disclosureLine(brandName: string): string {
  return `Full disclosure: I work at ${brandName}.`;
}

/** Every figure in a sentence ("40", "3x", "20%", "$12") — numerals only. */
export function figuresIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\s*(%|x\b)?/gi) ?? [])
    .map((f) => f.replace(/[\s,]/g, "").replace(/\.$/, "").toLowerCase())
    .filter((f) => /\d/.test(f));
}

/** A sentence is grounded when each of its figures appears in the facts. */
export function figuresKnown(sentence: string, facts: string): boolean {
  const known = new Set(figuresIn(facts));
  return figuresIn(sentence).every((f) => known.has(f) || known.has(f.replace(/[%x]$/, "")));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Remove links that aren't the brand's own site (or the thread itself). */
export function keepOwnLinks(text: string, allowedHosts: readonly string[]): string {
  const allowed = allowedHosts.map((h) => h.toLowerCase().replace(/^www\./, "")).filter(Boolean);
  return text.replace(/https?:\/\/[^\s)\]]+/g, (url) => {
    const host = hostOf(url);
    return allowed.some((a) => host === a || host.endsWith(`.${a}`)) ? url : "";
  });
}

const PARA = "\n\n";

export type FinishedReply = { text: string; disclosed: boolean; removed: number };

export function finishReply(
  draft: string,
  opts: {
    brandName: string;
    brandDomain: string | null;
    source: CommunitySource;
    /** Everything the brand has said about itself (DNA, products, the thread). */
    facts: string;
  },
): FinishedReply {
  const cleaned = keepOwnLinks(
    draft
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .trim(),
    opts.brandDomain ? [opts.brandDomain] : [],
  );
  // Sentence by sentence, keeping paragraph breaks.
  let removed = 0;
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => {
      const kept = withoutUnknownFacts(p, (s) => figuresKnown(s, opts.facts));
      removed += kept.removed;
      return kept.text.replace(/\s{2,}/g, " ").trim();
    })
    .filter(Boolean);
  let text = paragraphs.join("\n\n");

  const named =
    mentions(text, opts.brandName) ||
    (!!opts.brandDomain && text.toLowerCase().includes(opts.brandDomain.toLowerCase()));
  const line = disclosureLine(opts.brandName);
  const room = MAX_REPLY_CHARS[opts.source] - (named ? line.length + 2 : 0);
  if (text.length > room) {
    const cut = text.slice(0, room);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    text = (end > room / 2 ? cut.slice(0, end + 1) : cut).trim();
  }
  if (named && !DISCLOSURE_RE.test(text)) text = [text, line].join(PARA);
  const disclosed = named;
  return { text: text.trim(), disclosed, removed };
}

/** True when the draft already says who wrote it. Exported for tests. */
export function hasDisclosure(text: string): boolean {
  return DISCLOSURE_RE.test(text);
}
