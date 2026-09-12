// output-check.ts — checks on generated content before it leaves the product
// (proposal workstream D: "Output brand-safety and claim checking before
// generated content reaches a client portal" and "PII and profanity filtering
// on generated output").
//
// Deterministic and explainable by design: every finding names its rule and
// the matched snippet, so the user sees exactly why something was flagged.
//   • PII — emails, phone numbers, Luhn-valid card numbers, IBANs, SSN-like ids
//     (redactable);
//   • profanity — a small curated list (word-boundary matched);
//   • claims — absolute/unsubstantiated superlatives, guarantees, medical and
//     financial promises;
//   • brand rules — the brand's own "don't" list from Brand DNA.
// Severity "block" means a human must acknowledge before sharing/publishing.
import "server-only";

export type OutputFindingKind = "pii" | "profanity" | "claim" | "brand_rule";
export type OutputSeverity = "warn" | "block";

export type OutputFinding = {
  kind: OutputFindingKind;
  rule: string;
  severity: OutputSeverity;
  snippet: string;
};

export type OutputCheck = {
  ok: boolean;
  /** Highest severity found, or null when clean. */
  severity: OutputSeverity | null;
  findings: OutputFinding[];
};

const PII_RULES: Array<{ rule: string; re: RegExp; severity: OutputSeverity }> = [
  { rule: "email_address", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, severity: "warn" },
  {
    // International (+92 300 1234567, +1-415-555-0100) or local with
    // separators ((042) 3576-1234, 0300-123-4567). Bare digit runs are left
    // alone so prices, years and order numbers are not flagged.
    rule: "phone_number",
    re: /(?<![\w/+])(?:\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,5}|\(?\d{3,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4})(?![\w/])/g,
    severity: "warn",
  },
  { rule: "iban", re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, severity: "block" },
  { rule: "national_id", re: /\b\d{3}-\d{2}-\d{4}\b|\b\d{5}-\d{7}-\d\b/g, severity: "block" },
];
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;

const PROFANITY = [
  "fuck",
  "fucking",
  "shit",
  "bullshit",
  "bitch",
  "bastard",
  "asshole",
  "dickhead",
  "cunt",
  "motherfucker",
  "wanker",
];

const CLAIM_RULES: Array<{ rule: string; re: RegExp; severity: OutputSeverity }> = [
  {
    rule: "guarantee",
    re: /\b(guaranteed?|100%\s+(?:results|success|satisfaction|safe)|risk[- ]free|no risk)\b/gi,
    severity: "warn",
  },
  {
    rule: "unverified_superlative",
    re: /\b(#1|number one|the best in the (?:world|country|industry)|world'?s (?:best|leading|first)|unbeatable|best[- ]ever)\b/gi,
    severity: "warn",
  },
  {
    rule: "medical_claim",
    re: /\b(cures?|heals?|treats?|prevents?)\s+(?:cancer|diabetes|covid|disease|depression|anxiety|obesity)\b|\bclinically proven\b/gi,
    severity: "block",
  },
  {
    rule: "financial_promise",
    re: /\b(guaranteed (?:returns?|profits?|income)|double your money|get rich quick|earn \$?\d[\d,]*\s*(?:per|a)\s*(?:day|week))\b/gi,
    severity: "block",
  },
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function snippetOf(text: string, index: number, length: number): string {
  return text
    .slice(Math.max(0, index - 20), index + length + 20)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Run every output check. `brandDont` is the brand's own "don't" list. */
export function checkOutput(text: string, opts: { brandDont?: string[] } = {}): OutputCheck {
  const findings: OutputFinding[] = [];
  const add = (
    kind: OutputFindingKind,
    rule: string,
    severity: OutputSeverity,
    m: RegExpExecArray,
  ) => findings.push({ kind, rule, severity, snippet: snippetOf(text, m.index, m[0].length) });

  // Cards first; their digits are then masked so the phone/id rules do not
  // re-report fragments of the same number.
  let masked = text;
  for (const m of text.matchAll(CARD_CANDIDATE)) {
    if (!luhnValid(m[0].replace(/\D/g, ""))) continue;
    add("pii", "payment_card", "block", m as RegExpExecArray);
    masked =
      masked.slice(0, m.index) + "#".repeat(m[0].length) + masked.slice(m.index + m[0].length);
  }
  for (const r of PII_RULES) {
    for (const m of masked.matchAll(r.re)) add("pii", r.rule, r.severity, m as RegExpExecArray);
  }
  const profanityRe = new RegExp(`\\b(${PROFANITY.map(escapeRe).join("|")})\\b`, "gi");
  for (const m of text.matchAll(profanityRe))
    add("profanity", "profanity", "warn", m as RegExpExecArray);
  for (const r of CLAIM_RULES) {
    for (const m of text.matchAll(r.re)) add("claim", r.rule, r.severity, m as RegExpExecArray);
  }
  for (const phrase of opts.brandDont ?? []) {
    const p = phrase.trim();
    if (p.length < 3 || p.length > 80) continue;
    const re = new RegExp(`\\b${escapeRe(p)}\\b`, "gi");
    for (const m of text.matchAll(re))
      add("brand_rule", `brand_dont:${p.slice(0, 40)}`, "warn", m as RegExpExecArray);
  }

  const severity = findings.some((f) => f.severity === "block")
    ? "block"
    : findings.length
      ? "warn"
      : null;
  return { ok: findings.length === 0, severity, findings: findings.slice(0, 50) };
}

/** Replace PII with typed placeholders (e.g. "[email removed]"). */
export function redactPii(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text.replace(CARD_CANDIDATE, (m) => {
    if (!luhnValid(m.replace(/\D/g, ""))) return m;
    redactions++;
    return "[card number removed]";
  });
  for (const r of PII_RULES) {
    out = out.replace(r.re, () => {
      redactions++;
      return `[${r.rule.replace(/_/g, " ")} removed]`;
    });
  }
  return { text: out, redactions };
}
