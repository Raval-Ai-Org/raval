// keywords.ts — does a comment contain one of an automation's words? Pure.
//
// Ported from OpenReply's keyword matcher (lib/utils/keyword-matcher.ts,
// https://github.com/diwenne/openreply, MIT License, Copyright (c) 2026
// Anish Raj and Diwen Huang). The licence notice is kept in
// docs/engage/THIRD_PARTY.md. What it handles, and why:
//   * any script: Unicode letter/number classes, never ASCII \w or \b;
//   * Latin accents: "preço" and "PRECO" match, other scripts' marks stay;
//   * Arabic script (Urdu, Persian, Arabic): letter variants from different
//     keyboards, optional harakat, tatweel, ZWNJ and Eastern digits fold to
//     one form, so "لینک" matches whichever yeh or kaf a phone sends;
//   * emoji and punctuation never block a match;
//   * a numeric keyword ("08") also matches the letter O typed for zero.

export type KeywordMatch = { matched: boolean; keyword: string | null };

const ARABIC_SCRIPT_FOLDING: Array<[RegExp, string]> = [
  [/[يىے]/gu, "ی"], // Arabic yeh, alef maksura, barree ye → Farsi yeh
  [/ك/gu, "ک"], // Arabic kaf → keheh
  [/ة/gu, "ه"], // teh marbuta → heh
  [/[آأإٱ]/gu, "ا"], // alef with madda / hamza / wasla → alef
  [/[ً-ْٰ]/gu, ""], // harakat, sukun, superscript alef
  [/ـ/gu, ""], // tatweel
  [/[‌‎‏]/gu, ""], // ZWNJ and bidi marks
];

const EASTERN_DIGITS = /[۰-۹٠-٩]/gu;

export function normalizeArabicScript(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ARABIC_SCRIPT_FOLDING)
    out = out.replace(pattern, replacement);
  return out.replace(EASTERN_DIGITS, (digit) => {
    const code = digit.codePointAt(0)!;
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** Letters (any script), numbers and combining marks only; everything else is a space. */
export function stripSpecialCharacters(text: string): string {
  return text
    .replace(
      /\p{Extended_Pictographic}|[\u{1F1E0}-\u{1F1FF}]|\u{FE0F}|\u{FE0E}|\u{200D}|\u{20E3}/gu,
      "",
    )
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop Latin diacritics only; every other script's marks are meaningful. */
export function foldDiacritics(text: string): string {
  let out = "";
  let baseIsLatin = false;
  for (const char of text.normalize("NFD")) {
    if (/\p{M}/u.test(char)) {
      if (!baseIsLatin) out += char;
      continue;
    }
    baseIsLatin = /\p{Script=Latin}/u.test(char);
    out += char;
  }
  return out.normalize("NFC");
}

export function cleanForMatch(text: string): string {
  return foldDiacritics(stripSpecialCharacters(normalizeArabicScript(text))).toLowerCase();
}

const numericLike = (k: string) => /^[0-9o]+$/i.test(k);
const foldO = (v: string) => v.replace(/o/gi, "0");

export function matchKeywords(
  comment: string,
  keywords: readonly string[],
  wholeWord = true,
): KeywordMatch {
  const text = comment ? cleanForMatch(comment) : "";
  if (!text || keywords.length === 0) return { matched: false, keyword: null };
  for (const keyword of keywords) {
    const k = cleanForMatch(keyword);
    if (!k) continue;
    const num = numericLike(k);
    const hay = num ? foldO(text) : text;
    const needle = num ? foldO(k) : k;
    if (wholeWord) {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(hay))
        return { matched: true, keyword };
    } else if (hay.includes(needle)) {
      return { matched: true, keyword };
    }
  }
  return { matched: false, keyword: null };
}
