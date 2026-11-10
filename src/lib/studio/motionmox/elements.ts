// What MotionMox can animate into a person's own video. Code decides when and
// where each element appears; the words always come from the approved copy.
// Ids are stored on jobs (`controls.motionElements`): add, never rename.
// Pure and browser-safe.

export const MOTIONMOX_ELEMENT_IDS = [
  "headline",
  "lower-third",
  "captions",
  "logo-bug",
  "price-tag",
  "badge",
  "cta",
  "end-card",
  "progress-bar",
] as const;
export type MotionMoxElementId = (typeof MOTIONMOX_ELEMENT_IDS)[number];

export type MotionMoxElement = {
  id: MotionMoxElementId;
  /** Plain words for the "Add to the video" chips. */
  label: string;
  /** Shown as a chip in Studio (some are only ever added by the planner). */
  chip: boolean;
  /** Most words it may carry; longer copy is not used for it. */
  maxWords: number;
  /** Seconds to come in, and to go out. */
  enter: number;
  exit: number;
  /** Where it sits, as a share of the canvas (inside the safe area). */
  zone: "top" | "middle" | "lower-third" | "corner" | "bottom" | "full";
};

export const MOTIONMOX_ELEMENTS: Record<MotionMoxElementId, MotionMoxElement> = {
  headline: {
    id: "headline",
    label: "Headline",
    chip: true,
    maxWords: 8,
    enter: 0.5,
    exit: 0.4,
    zone: "top",
  },
  "lower-third": {
    id: "lower-third",
    label: "Name or line",
    chip: false,
    maxWords: 10,
    enter: 0.45,
    exit: 0.35,
    zone: "lower-third",
  },
  captions: {
    id: "captions",
    label: "Captions",
    chip: true,
    maxWords: 12,
    enter: 0.12,
    exit: 0.1,
    zone: "bottom",
  },
  "logo-bug": {
    id: "logo-bug",
    label: "Logo",
    chip: true,
    maxWords: 0,
    enter: 0.6,
    exit: 0.4,
    zone: "corner",
  },
  "price-tag": {
    id: "price-tag",
    label: "Price",
    chip: true,
    maxWords: 4,
    enter: 0.4,
    exit: 0.3,
    zone: "middle",
  },
  badge: {
    id: "badge",
    label: "Badge",
    chip: false,
    maxWords: 3,
    enter: 0.35,
    exit: 0.3,
    zone: "corner",
  },
  cta: {
    id: "cta",
    label: "Button",
    chip: true,
    maxWords: 4,
    enter: 0.45,
    exit: 0.3,
    zone: "bottom",
  },
  "end-card": {
    id: "end-card",
    label: "End card",
    chip: true,
    maxWords: 0,
    enter: 0.5,
    exit: 0,
    zone: "full",
  },
  "progress-bar": {
    id: "progress-bar",
    label: "Progress bar",
    chip: false,
    maxWords: 0,
    enter: 0.2,
    exit: 0.2,
    zone: "top",
  },
};

export const MOTIONMOX_CHIPS = MOTIONMOX_ELEMENT_IDS.filter((id) => MOTIONMOX_ELEMENTS[id].chip);

export function isMotionMoxElement(value: unknown): value is MotionMoxElementId {
  return typeof value === "string" && (MOTIONMOX_ELEMENT_IDS as readonly string[]).includes(value);
}

/** Safe area as a share of each side, the same margins motion graphics use. */
export const MOTIONMOX_SAFE = { x: 0.06, top: 0.08, bottom: 0.12 } as const;

/** Shortest time a text element stays fully on screen, so it can be read. */
export const MIN_READ_SECONDS = 1.6;

/** Seconds a person needs for `words` words (about 3 words a second, never under MIN_READ_SECONDS). */
export function readSeconds(words: number): number {
  return Math.max(MIN_READ_SECONDS, Math.round((words / 3 + 0.6) * 10) / 10);
}

/** 0→1→0 visibility of an element at time t, from its own enter/exit. Pure, used by the compositions and tests. */
export function visibility(
  t: number,
  span: { from: number; to: number },
  element: Pick<MotionMoxElement, "enter" | "exit">,
): number {
  if (t < span.from || t > span.to) return 0;
  const inT = element.enter > 0 ? (t - span.from) / element.enter : 1;
  const outT = element.exit > 0 ? (span.to - t) / element.exit : 1;
  return Math.max(0, Math.min(1, inT, outT));
}

const ask = (words: string) => new RegExp(`\\b(?:${words})\\b`, "i");

/** What the person asked for, read from their own words with string work only. */
const ASKS: [MotionMoxElementId, RegExp][] = [
  ["headline", ask("headline|title|heading|big text|add (?:the )?text|text on (?:it|the video)")],
  ["captions", ask("captions?|subtitles?|subs")],
  ["logo-bug", ask("logo|watermark")],
  ["price-tag", ask("price|prices|pricing|cost|rs\\.?|pkr|\\$\\d+|discount|% off|sale")],
  [
    "cta",
    ask("cta|button|shop now|buy now|order now|book now|call now|sign up|link in bio|end with"),
  ],
  ["end-card", ask("end card|ending card|outro|closing card|sign[- ]off")],
  ["badge", ask("badge|sticker|limited time|limited edition|just launched")],
  ["lower-third", ask("lower third|name tag|name card|our team|introduc\\w*")],
  ["progress-bar", ask("progress bar|timer bar")],
];

/** The elements a brief asks for, in a stable order. Empty when it names none. */
export function elementsFromBrief(brief: string): MotionMoxElementId[] {
  const asked = new Set<MotionMoxElementId>();
  for (const [id, re] of ASKS) if (re.test(brief)) asked.add(id);
  return MOTIONMOX_ELEMENT_IDS.filter((id) => asked.has(id));
}

/** Words the person quoted in their brief ("end with 'Shop now'"): their own words, so they may be shown. */
export function quotedPhrases(brief: string): string[] {
  const out: string[] = [];
  for (const m of brief.matchAll(/["“'‘]([^"”'’\n]{2,60})["”'’]/g)) {
    const phrase = m[1].replace(/\s+/g, " ").trim();
    if (phrase && !out.includes(phrase)) out.push(phrase);
  }
  return out;
}
