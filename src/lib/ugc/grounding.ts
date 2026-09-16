// Claim grounding for UGC scripts. An ad may only claim what the product facts
// support: specific numbers, results, certifications, rankings, guarantees and
// prices are the claims that get ads rejected and customers misled, so each
// one found in spoken dialogue or captions must be traceable to a fact.
//
// Pure and deterministic — it runs server-side on generated concepts (which
// are repaired once when flagged) and live in the script editor as the user
// types.
import type { ProductFact, Script } from "./schemas";

export type ClaimWarning = {
  sceneId: string | null;
  field: "dialogue" | "caption" | "hook" | "cta" | "postCaption";
  claim: string;
  message: string;
};

type ClaimPattern = { re: RegExp; kind: string };

const CLAIM_PATTERNS: ClaimPattern[] = [
  { re: /\b\d+(?:[.,]\d+)?\s?%/g, kind: "a percentage" },
  {
    re: /[$€£¥₹]\s?\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/gi,
    kind: "a price",
  },
  {
    re: /\b\d+(?:[.,]\d+)?\s?(?:x|times)\b(?:\s+(?:faster|more|better|stronger|longer))?/gi,
    kind: "a multiplier",
  },
  {
    re: /\b(?:in|within|after|for)\s+(?:just\s+|only\s+)?\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/gi,
    kind: "a timed result",
  },
  {
    re: /\b\d[\d,.]*\s*(?:\+\s*)?(?:customers|users|reviews|people|sold|downloads|clients)\b/gi,
    kind: "a usage figure",
  },
  {
    re: /\b(?:clinically|scientifically|dermatologist|doctor|lab)[-\s](?:proven|tested|recommended|approved)\b/gi,
    kind: "a professional endorsement",
  },
  {
    re: /\b(?:fda|iso|usda|organic|vegan|cruelty[- ]free|gluten[- ]free|non[- ]gmo)[- ]?(?:approved|certified)?\b/gi,
    kind: "a certification",
  },
  {
    re: /(?:#\s?1|\bnumber one\b|\bbest[- ]selling\b|\bbestseller\b|\baward[- ]winning\b|\brated best\b)/gi,
    kind: "a ranking or award",
  },
  {
    re: /\b(?:guarantee[ds]?|money[- ]back|risk[- ]free|lifetime warranty)\b/gi,
    kind: "a guarantee",
  },
  {
    re: /\b(?:cures?|heals?|prevents?|eliminates?|reverses?)\b/gi,
    kind: "a medical or absolute effect",
  },
  { re: /\bfree (?:shipping|delivery|returns|trial)\b/gi, kind: "an offer" },
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Distinctive tokens of a claim (numbers and non-trivial words). */
function claimTokens(claim: string): string[] {
  const n = normalize(claim);
  const numbers = n.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.length) return numbers.map((x) => x.replace(",", "."));
  return n
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !["for", "the", "and", "just", "only"].includes(w));
}

function supported(claim: string, factText: string): boolean {
  const tokens = claimTokens(claim);
  if (!tokens.length) return false;
  const fact = normalize(factText).replace(/,(?=\d)/g, ".");
  return tokens.every((t) => fact.includes(t));
}

export function findClaims(text: string): Array<{ claim: string; kind: string }> {
  const found: Array<{ claim: string; kind: string }> = [];
  for (const { re, kind } of CLAIM_PATTERNS) {
    for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
      const claim = match[0].trim();
      if (claim && !found.some((f) => f.claim.toLowerCase() === claim.toLowerCase())) {
        found.push({ claim, kind });
      }
    }
  }
  return found;
}

/** Every claim in the script that no product fact supports. */
export function checkScriptClaims(
  script: Pick<Script, "hook" | "scenes" | "cta" | "postCaption">,
  facts: Pick<ProductFact, "text">[],
): ClaimWarning[] {
  const factTexts = facts.map((f) => f.text);
  const warnings: ClaimWarning[] = [];
  const check = (text: string, field: ClaimWarning["field"], sceneId: string | null) => {
    for (const { claim, kind } of findClaims(text)) {
      if (factTexts.some((f) => supported(claim, f))) continue;
      if (warnings.some((w) => w.claim.toLowerCase() === claim.toLowerCase())) continue;
      warnings.push({
        sceneId,
        field,
        claim,
        message: `"${claim}" is ${kind} that isn't in the product facts. Remove it or add the fact.`,
      });
    }
  };
  check(script.hook, "hook", null);
  for (const scene of script.scenes) {
    check(scene.dialogue, "dialogue", scene.id);
    check(scene.caption, "caption", scene.id);
  }
  check(script.cta, "cta", null);
  check(script.postCaption, "postCaption", null);
  return warnings;
}

/** Keep only fact ids that exist. */
export function validFactIds(ids: string[], facts: Pick<ProductFact, "id">[]): string[] {
  const known = new Set(facts.map((f) => f.id));
  return [...new Set(ids)].filter((id) => known.has(id));
}
