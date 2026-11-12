// image-defects.ts — which visual-review notes are worth a second picture (pure).
//
// The review (`studio.image.review`) returns free-text issues. A re-render
// costs a full picture plus another review, so only defects a person can't
// publish are made again: wrong or misspelled words, a wrong, invented or
// missing product, a covered face, broken anatomy, an unreadable result.
// Taste notes (composition, colour balance, mood, "could be bolder") are kept
// as notes on the piece; a person can still ask for a change in the edit chat.

const HARD = [
  /misspel|spelling|typo|wrong (word|text|letter)|extra (word|text|letter)s?|missing (word|text|letter)/i,
  /garbled|gibberish|nonsense (text|letters)|illegible|unreadable|scrambled/i,
  /(wrong|different|invented|second|extra|missing|altered|distorted) product/i,
  /product('s)? (shape|colou?r|label|logo)s? (differ|changed|wrong|altered)/i,
  /(inside|in) a (frame|card|box|window)/i,
  /face (is )?(covered|hidden|cut off|obscured)|cover(s|ing)? (a |the )?(person's )?face/i,
  /(extra|missing|fused|deformed|malformed) (finger|hand|limb|arm|leg|eye)s?|deformed|malformed/i,
  /fake (logo|brand)|invented (logo|brand|badge|claim|price|offer)/i,
  /blank|empty (image|picture|canvas)|corrupt/i,
];

/** The issues that justify one automatic re-render (all others stay notes). */
export function hardImageDefects(issues: readonly string[]): string[] {
  return issues.filter((issue) => HARD.some((rule) => rule.test(issue)));
}
