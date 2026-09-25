// Does this text follow the Style's writing rules? Pure string checks — free,
// instant, no AI. Only checks what can be checked mechanically; tone is left
// to the model and to people.
import type { ResolvedStyle } from "./resolve";

export type ConformanceIssue = {
  code:
    | "banned-word"
    | "emoji"
    | "hashtag-count"
    | "missing-hashtag"
    | "hashtag-case"
    | "length"
    | "casing";
  message: string;
  severity: "high" | "low";
};

export type Conformance = {
  /** 0..100. 100 = nothing to flag. */
  score: number;
  issues: ConformanceIssue[];
  /** Number of rules that could be checked at all. */
  checked: number;
};

// Pictographic emoji; skips digits/#/* keycap bases.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /(^|\s)#([\p{L}\p{N}_]+)/gu;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function countEmoji(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(HASHTAG_RE)].map((m) => m[2]);
}

export function checkWritingConformance(text: string, resolved: ResolvedStyle): Conformance {
  const w = resolved.writing;
  const issues: ConformanceIssue[] = [];
  let checked = 0;
  const body = text ?? "";

  if (w.bannedWords?.length) {
    checked++;
    const hits = w.bannedWords.filter((word) =>
      new RegExp(`(^|[^\\p{L}])${escapeRe(word)}($|[^\\p{L}])`, "iu").test(body),
    );
    for (const h of hits.slice(0, 5)) {
      issues.push({
        code: "banned-word",
        message: `Uses "${h}", which this style avoids`,
        severity: "high",
      });
    }
  }

  if (w.emoji) {
    checked++;
    const n = countEmoji(body);
    if (w.emoji === "none" && n > 0) {
      issues.push({
        code: "emoji",
        message: `Has ${n} emoji; this style uses none`,
        severity: "high",
      });
    } else if (w.emoji === "light" && n > 3) {
      issues.push({
        code: "emoji",
        message: `Has ${n} emoji; this style keeps it light`,
        severity: "low",
      });
    }
  }

  const tags = extractHashtags(body);
  if (w.hashtags?.count != null) {
    checked++;
    const want = w.hashtags.count;
    if (want === 0 && tags.length) {
      issues.push({
        code: "hashtag-count",
        message: `Has ${tags.length} hashtags; this style uses none`,
        severity: "high",
      });
    } else if (want > 0 && Math.abs(tags.length - want) > Math.max(2, Math.round(want / 2))) {
      issues.push({
        code: "hashtag-count",
        message: `Has ${tags.length} hashtags; this style uses about ${want}`,
        severity: "low",
      });
    }
  }
  if (w.hashtags?.always?.length) {
    checked++;
    const have = new Set(tags.map((t) => t.toLowerCase()));
    for (const t of w.hashtags.always) {
      const bare = t.replace(/^#/, "").toLowerCase();
      if (!have.has(bare)) {
        issues.push({
          code: "missing-hashtag",
          message: `Missing #${t.replace(/^#/, "")}`,
          severity: "low",
        });
      }
    }
  }
  if (w.hashtags?.casing === "lower" && tags.length) {
    checked++;
    if (tags.some((t) => t !== t.toLowerCase())) {
      issues.push({
        code: "hashtag-case",
        message: "Hashtags should be lowercase",
        severity: "low",
      });
    }
  }

  if (w.formatting?.maxChars) {
    checked++;
    if (body.length > w.formatting.maxChars) {
      issues.push({
        code: "length",
        message: `${body.length} characters; this style stays under ${w.formatting.maxChars}`,
        severity: "low",
      });
    }
  }

  if (w.casing === "lower" || w.casing === "upper") {
    checked++;
    const letters = body
      .replace(HASHTAG_RE, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[^\p{L}]/gu, "");
    if (letters.length > 10) {
      const wrong =
        w.casing === "lower"
          ? letters !== letters.toLowerCase()
          : letters !== letters.toUpperCase();
      if (wrong)
        issues.push({
          code: "casing",
          message: `This style is all ${w.casing}case`,
          severity: "low",
        });
    }
  }

  const penalty = issues.reduce((sum, i) => sum + (i.severity === "high" ? 25 : 10), 0);
  return { score: Math.max(0, 100 - penalty), issues, checked };
}

/** One-line instruction for the refine path: "Fix to style". */
export function conformanceFixInstruction(c: Conformance): string {
  if (!c.issues.length) return "";
  return `Rewrite to follow the writing style exactly. Fix: ${c.issues.map((i) => i.message).join("; ")}. Keep every fact, link and number.`;
}
