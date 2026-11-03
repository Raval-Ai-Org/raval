// What a Mellox motion graphic knows about motion design. Pure and
// browser-safe; the motion-graphics prompt (src/server/studio/motion/) reads it.
// Add a rule here, never in one prompt only. Written brand-neutral: no studio,
// brand or artist is named.
//
// A motion graphic is designed by the model as one HTML/SVG + CSS document
// (CSS @keyframes only) and drawn frame by frame by Chromium. The words are
// the reviewed copy, exactly; the brand's real logo and product photos are
// placed by code into named slots. That is why it can be crisp where AI video
// warps text, and cheap where AI video is expensive.

import type { MusicMood } from "@/lib/studio/audio/soundtrack";

/** Proven motion-graphic layouts. Ids are stored on jobs: add, never rename. */
export const MOTION_LAYOUTS = [
  {
    id: "kinetic-statement",
    name: "Kinetic statement",
    use: "One strong line, word by word",
    how: "Huge type fills the frame; each word or short phrase snaps in on the beat (scale from 85% with a little overshoot, or a mask wipe), holds, then the next replaces it. One idea per screen. Ends on the logo and the call to action.",
  },
  {
    id: "product-spotlight",
    name: "Product spotlight",
    use: "Show one product and why it matters",
    how: "The product photo slot enters with a soft scale and a shadow that grows under it; two or three short benefit lines orbit or stack beside it one at a time, each with a small icon drawn in SVG strokes. A colour field behind it shifts once halfway through.",
  },
  {
    id: "split-reveal",
    name: "Split reveal",
    use: "Before and after, problem and answer",
    how: "The frame splits in two with a moving divider; the left side states the problem in muted colour, the divider sweeps across and the brand colour answer takes over. The product or logo lands at the end.",
  },
  {
    id: "stat-counter",
    name: "Number reveal",
    use: "Only when the brand gave a real figure",
    how: "A single figure builds up on screen with a bar or ring that fills to it; the line that explains it slides in under it. Never invent the number: use only one the copy contains.",
  },
  {
    id: "list-cascade",
    name: "Steps cascade",
    use: "Three tips, steps or reasons",
    how: "Numbered cards cascade in from below one by one with a slight overlap and stagger; the current one is full colour, earlier ones dim and shrink upward. The final card is the call to action.",
  },
  {
    id: "offer-burst",
    name: "Offer burst",
    use: "A sale, a launch date, an event",
    how: "Shapes burst outward from the centre on the first beat, the offer line lands in the middle with a punchy scale, the date or detail ticks in under it, then everything settles into a clean end card with the logo.",
  },
  {
    id: "quote-card",
    name: "Quote reveal",
    use: "A customer's real words or a founder line",
    how: "Large quotation marks draw in as SVG strokes, the quote types in phrase by phrase in the brand font, the name fades in under it. Calm, generous margins, slow camera drift on the whole card.",
  },
  {
    id: "logo-sting",
    name: "Logo sting",
    use: "Short brand moment, an opener or ender",
    how: "Abstract brand-colour shapes fly in, collide and resolve into the logo slot with a satisfying settle; one short line appears under it. Four to six seconds.",
  },
] as const;

export type MotionLayoutId = (typeof MOTION_LAYOUTS)[number]["id"];

/** The craft rules every motion graphic follows (the animation principles, made concrete). */
export const MOTION_RULES: readonly string[] = [
  "Hook in the first 1.5 seconds: the first frame already shows a bold shape or word, never an empty screen; something moves within 0.3 s.",
  "One idea per scene. A scene is 1.5-3 seconds. At most 7 words on screen at once.",
  "Every line of words stays fully readable for at least 1.2 seconds before it leaves.",
  "Ease everything: entrances cubic-bezier(0.16, 1, 0.3, 1), exits cubic-bezier(0.7, 0, 0.84, 0); never linear except for a constant drift.",
  "Anticipation and overshoot: a big entrance dips 3-5% before it moves, or overshoots 4-8% and settles back.",
  "Follow-through and overlap: parts of one group start 60-120 ms apart, never all at once.",
  "Arcs and secondary motion: objects travel on gentle curves; a small secondary element (a dot, a line, a shadow) reacts to the main one.",
  "Squash and stretch only on playful, round shapes; keep type rigid.",
  "Staging: one focal point at a time; dim or shrink what is not the subject.",
  "Timing on the beat: big changes land on the beat grid given below; small moves between beats.",
  "Hold the end: the last 1.5 seconds are still, showing the logo slot and the call to action.",
  "Use the brand's colours as large fields and accents; text is the brand's text colour or white/near-black, whichever reads.",
  "Type: the brand font through var(--font-heading) and var(--font-body); headings 7-14% of the frame width, body at least 4% of the width. Tight tracking on big headings.",
  "Keep every word inside the safe area: the frame minus 6% at the sides, 10% at the top and 18% at the bottom (platform buttons and captions sit there).",
  "No stock clichés: no lens flares, no spinning 3D globes, no glitch for its own sake, no fake UI that the brand doesn't have.",
];

/** Platform safe area, as fractions of the frame (Reels, TikTok and Shorts buttons). */
export const SAFE_AREA = { left: 0.06, right: 0.06, top: 0.1, bottom: 0.18 } as const;

/** Smallest readable type: 3.2% of the frame width (about 35 px on a 1080 px video). */
export const MIN_FONT_FRACTION = 0.032;

/** How long the end holds still. */
export const END_HOLD_SECONDS = 1.5;

/** Beat grid lines for the prompt: the times big changes land on. */
export function beatGrid(seconds: number, beat: number): string {
  const step = beat * 2;
  const times: string[] = [];
  for (let t = 0; t <= seconds - END_HOLD_SECONDS + 1e-6; t += step)
    times.push(t.toFixed(2).replace(/\.?0+$/, "") || "0");
  return times.join(", ");
}

/** A layout that fits the brief, unless the brand's last two motion graphics used it. */
export function pickMotionLayout(args: {
  brief: string;
  hasProductPhoto: boolean;
  hasFigure: boolean;
  recent?: readonly (string | null | undefined)[];
  seed: number;
}): MotionLayoutId {
  const recent = new Set((args.recent ?? []).slice(0, 2).filter(Boolean));
  const brief = args.brief.toLowerCase();
  const wanted: MotionLayoutId[] = [];
  if (/\b(sale|off|discount|offer|launch|event|deal|today only|drop)\b/.test(brief))
    wanted.push("offer-burst");
  if (/\b(before|after|problem|instead|vs|versus|tired of)\b/.test(brief))
    wanted.push("split-reveal");
  if (/\b(tips?|steps?|ways|reasons|how to)\b/.test(brief)) wanted.push("list-cascade");
  if (/["“”]|\b(review|said|says|testimonial|quote)\b/.test(brief)) wanted.push("quote-card");
  if (args.hasFigure) wanted.push("stat-counter");
  if (args.hasProductPhoto) wanted.push("product-spotlight");
  wanted.push("kinetic-statement", "logo-sting");
  const usable = wanted.filter((id) => !recent.has(id));
  const pool = usable.length ? usable : wanted;
  // The first fit wins; the seed only breaks ties between the always-fitting two.
  const first = pool[0];
  if (first !== "kinetic-statement" || pool.length < 2) return first;
  return pool[args.seed % 2 === 0 ? 0 : 1];
}

/** The motion-design part of the prompt. */
export function motionKnowledge(args: {
  layout: MotionLayoutId;
  seconds: number;
  mood: MusicMood;
  beat: number;
}): string {
  const layout = MOTION_LAYOUTS.find((l) => l.id === args.layout)!;
  return [
    `## Layout: ${layout.name}`,
    `${layout.use}. ${layout.how}`,
    "",
    "## Craft rules",
    ...MOTION_RULES.map((r) => `- ${r}`),
    "",
    `## Timing`,
    `- Total length ${args.seconds} s. Music feel: ${args.mood}. Beat every ${args.beat.toFixed(2)} s.`,
    `- Big changes land at: ${beatGrid(args.seconds, args.beat)} s.`,
    `- Everything has finished moving by ${(args.seconds - END_HOLD_SECONDS).toFixed(1)} s and holds still to the end.`,
  ].join("\n");
}
