// Written by scripts/generate-ugc-format-thumbs.mjs: the Creator video formats
// that have a picture at public/ugc-formats/<id>.jpg. Don't edit by hand.

export const FORMAT_THUMB_IDS: readonly string[] = [
  "ask-the-pro",
  "asmr-hands",
  "before-after",
  "call-skit",
  "car-confessional",
  "cook-with-me",
  "couch-debate",
  "day-in-life",
  "expectation-reality",
  "founder-story",
  "grwm",
  "honest-review",
  "hot-take",
  "infomercial-parody",
  "mirror-routine",
  "news-desk",
  "office-skit",
  "pack-order",
  "podcast-clip",
  "pov-skit",
  "reply-comment",
  "roommate-skit",
  "sidewalk-quiz",
  "storytime",
  "subway-interview",
  "three-reasons",
  "try-test",
  "two-roles",
  "unboxing",
  "walk-and-talk",
];

export function formatThumbPath(id: string): string | null {
  return FORMAT_THUMB_IDS.includes(id) ? `/ugc-formats/${id}.jpg` : null;
}
