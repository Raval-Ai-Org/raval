// A motion graphic as the model writes it, and every check code makes before
// and while it is drawn. Pure and browser-safe.
//
// The model proposes; code decides:
//   - the document may only be markup and CSS animation: no script, no event
//     handlers, no outside address of any kind (the page is drawn offline
//     behind a no-script policy as well);
//   - the words on screen must be the copy, exactly, and the copy may not add
//     a figure or a claim the brand never made;
//   - every word sits inside the platform safe area, big enough to read;
//   - every animation has finished before the end hold.
// A document that fails is asked for once more with the reasons, then the
// piece fails plainly (no template fallback, like photo design).

import { z } from "zod";
import { unknownClaims } from "@/lib/studio/video/storyboard";
import { END_HOLD_SECONDS, MIN_FONT_FRACTION, SAFE_AREA } from "./principles";

export const MOTION_MAX_SECONDS = 30;
export const MOTION_MIN_SECONDS = 4;
export const MOTION_MAX_COPY = 12;

export const MotionDocSchema = z.object({
  /** The scenes in order, for the review screen and the checks. */
  scenes: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        does: z.string().max(200),
      }),
    )
    .min(1)
    .max(12),
  /** Every piece of text that appears on screen, exactly as it appears. */
  copy: z.array(z.string().min(1).max(90)).min(1).max(MOTION_MAX_COPY),
  /** The markup inside the stage (a 100% x 100% box). */
  html: z.string().min(20).max(60_000),
  /** All styles, including @keyframes. */
  css: z.string().min(20).max(60_000),
});
export type MotionDoc = z.infer<typeof MotionDocSchema>;

/** The JSON schema the model answers with (strict: every field required). */
export const MOTION_DOC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes", "copy", "html", "css"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "does"],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          does: { type: "string" },
        },
      },
    },
    copy: { type: "array", items: { type: "string" } },
    html: { type: "string" },
    css: { type: "string" },
  },
} as const;

/** Named places the real logo and photos go: `<img data-slot="logo">`, `data-slot="photo-1"`. */
export const SLOT_RE = /data-slot\s*=\s*["']?(logo|photo-\d)["']?/gi;

const FORBIDDEN: [RegExp, string][] = [
  [/<\s*script\b/i, "a <script> tag"],
  [/<\s*(iframe|object|embed|frame|frameset|applet|portal)\b/i, "an embedded page"],
  [/<\s*(link|meta|base|style)\b/i, "a <link>, <meta>, <base> or <style> tag in the markup"],
  [/<\s*(form|input|button|textarea|select)\b/i, "a form control"],
  [/<\s*(video|audio|source|track|canvas)\b/i, "media or canvas elements"],
  [/<\s*foreignObject\b/i, "an SVG foreignObject"],
  [/\son[a-z]+\s*=/i, "an event handler attribute"],
  [/javascript\s*:/i, "a javascript: address"],
  [/\b(src|srcset|poster|action|formaction|background)\s*=/i, "a src or other address attribute"],
  [/\b(?:xlink:)?href\s*=\s*(?!["']?#)/i, "a link to anything other than #id inside the SVG"],
  [/url\(\s*(?!["']?#)/i, "url() other than an SVG #id"],
  [/@import\b/i, "@import"],
];

const FORBIDDEN_CSS: [RegExp, string][] = [
  [/@import\b/i, "@import"],
  [/@font-face\b/i, "@font-face (use var(--font-heading) and var(--font-body))"],
  [/url\(\s*(?!["']?#)/i, "url() other than an SVG #id"],
  [/expression\s*\(/i, "a CSS expression"],
  [/<\/?\s*style/i, "a style tag"],
];

const normal = (value: string) =>
  value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Figures in a line the brand never gave (prices, percentages, counts, dates). */
export function unknownFigures(line: string, known: string): string[] {
  const facts = normal(known);
  return (line.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => !facts.includes(n));
}

export type MotionCheckContext = {
  seconds: number;
  /** What the brand has said (Brand DNA, the brief, the product's facts, the reviewed script). */
  knownFacts: string;
  /** The words the person approved, when they gave exact copy; the copy must stay within them. */
  approvedCopy?: readonly string[];
  /** Slots that will be filled (the logo and N photos exist). */
  slots: { logo: boolean; photos: number };
};

/** Why a document can't be drawn, in words the model can fix. Empty when it is fine. */
export function staticIssues(doc: MotionDoc, ctx: MotionCheckContext): string[] {
  const issues: string[] = [];
  for (const [re, what] of FORBIDDEN)
    if (re.test(doc.html))
      issues.push(
        `The markup has ${what}; only markup, inline SVG and data-slot images are allowed.`,
      );
  for (const [re, what] of FORBIDDEN_CSS) if (re.test(doc.css)) issues.push(`The CSS has ${what}.`);
  if (/<\s*script\b|javascript\s*:/i.test(doc.css)) issues.push("The CSS has script in it.");

  for (const m of doc.html.matchAll(SLOT_RE)) {
    const slot = m[1].toLowerCase();
    if (slot === "logo" && !ctx.slots.logo)
      issues.push(
        "There is no logo for this brand; remove the logo slot and end on the brand name in type.",
      );
    const photo = slot.match(/^photo-(\d)$/);
    if (photo && Number(photo[1]) > ctx.slots.photos)
      issues.push(
        `Slot ${slot} has no photo; there ${ctx.slots.photos === 1 ? "is 1 photo" : `are ${ctx.slots.photos} photos`}.`,
      );
  }
  if (!/@keyframes\s/i.test(doc.css)) issues.push("Nothing moves: animate with CSS @keyframes.");

  const last = Math.max(...doc.scenes.map((s) => s.end));
  if (last > ctx.seconds + 0.05)
    issues.push(`The scenes run to ${last} s but the video is ${ctx.seconds} s.`);

  const known = `${ctx.knownFacts} ${(ctx.approvedCopy ?? []).join(" ")}`;
  for (const line of doc.copy) {
    for (const n of unknownFigures(line, known))
      issues.push(
        `"${line}" says ${n}, which the brand never said. Use only the brand's own figures.`,
      );
    for (const claim of unknownClaims(line, known))
      issues.push(`"${line}" claims "${claim}", which the brand never said.`);
  }
  if (ctx.approvedCopy?.length) {
    const approved = new Set(normal(ctx.approvedCopy.join(" ")).split(" "));
    for (const line of doc.copy) {
      const extra = normal(line)
        .split(" ")
        .filter((w) => w && !approved.has(w));
      if (extra.length)
        issues.push(
          `"${line}" adds words that are not in the approved copy (${extra.slice(0, 4).join(", ")}). Use the approved words only.`,
        );
    }
  }
  return issues;
}

/* ─────────────────────────── drawing the page ─────────────────────────── */

export type MotionCanvas = { width: number; height: number };

export type MotionPageInput = {
  doc: MotionDoc;
  canvas: MotionCanvas;
  /** Brand colours as CSS custom properties (--brand-primary, ...). */
  palette: Partial<Record<"primary" | "secondary" | "accent" | "background" | "text", string>>;
  /** @font-face rules for the brand's fonts, already as data: URLs (built by the server). */
  fontFaces: string;
  fonts: { heading: string; body: string };
  /** data: URLs for the slots that exist. */
  slots: Partial<Record<string, string>>;
};

const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const familyName = (name: string) => name.replace(/["'\\;{}<>]/g, "").trim() || "sans-serif";

/**
 * The full page Chromium draws. The document sits inside a fixed stage; the
 * policy refuses scripts and every address but data:, and the slots get
 * their pictures here, never from the model.
 */
export function motionPage(input: MotionPageInput): string {
  const { canvas } = input;
  const vars = Object.entries(input.palette)
    .filter(([, v]) => typeof v === "string" && HEX.test(v))
    .map(([k, v]) => `--brand-${k}:${v};`)
    .join("");
  let html = input.doc.html;
  html = html.replace(
    /<img\b([^>]*?)data-slot\s*=\s*["']?(logo|photo-\d)["']?([^>]*)>/gi,
    (_m, a, slot, b) => {
      const src = input.slots[String(slot).toLowerCase()];
      return src
        ? `<img${a}data-slot="${slot}"${b} src="${src}">`
        : `<img${a}data-slot="${slot}"${b}>`;
    },
  );
  const heading = familyName(input.fonts.heading);
  const body = familyName(input.fonts.body);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">
<style>${input.fontFaces}
:root{${vars}--font-heading:"${heading}",sans-serif;--font-body:"${body}",sans-serif;--w:${canvas.width}px;--h:${canvas.height}px;}
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;background:var(--brand-background,#111);}
#stage{position:relative;width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;font-family:var(--font-body);}
img[data-slot]{object-fit:contain;}
${input.doc.css}
</style></head><body><div id="stage">${html}</div></body></html>`;
}

/* ─────────────────────── checks on the drawn page ─────────────────────── */

/** One visible piece of text, measured in the browser at one moment. */
export type MeasuredText = {
  t: number;
  text: string;
  box: { x: number; y: number; width: number; height: number };
  fontSize: number;
  /** Opacity the viewer sees (product of ancestors). */
  opacity: number;
};

export type MeasuredPage = {
  canvas: MotionCanvas;
  texts: MeasuredText[];
  /** The latest moment any animation is still changing (seconds), Infinity for an endless one. */
  lastMotion: number;
  /** Contrast of each sampled line against the pixels behind it (text colour vs picture). */
  contrasts: { text: string; ratio: number }[];
};

/** Why the drawn page isn't ready, in words the model can fix. */
export function drawnIssues(page: MeasuredPage, doc: MotionDoc, seconds: number): string[] {
  const issues: string[] = [];
  const { width, height } = page.canvas;
  const safe = {
    left: width * SAFE_AREA.left,
    right: width * (1 - SAFE_AREA.right),
    top: height * SAFE_AREA.top,
    bottom: height * (1 - SAFE_AREA.bottom),
  };
  const copyWords = new Set(normal(doc.copy.join(" ")).split(" "));
  const seenWords = new Set<string>();
  const reported = new Set<string>();
  const once = (key: string, message: string) => {
    if (reported.has(key)) return;
    reported.add(key);
    issues.push(message);
  };
  for (const t of page.texts) {
    if (t.opacity < 0.6) continue;
    const words = normal(t.text).split(" ").filter(Boolean);
    words.forEach((w) => seenWords.add(w));
    const extra = words.filter((w) => !copyWords.has(w));
    if (extra.length)
      once(
        `extra:${t.text}`,
        `"${t.text}" is on screen but is not in the copy list. Show only the copy.`,
      );
    const b = t.box;
    const outside =
      b.x < safe.left - 2 ||
      b.x + b.width > safe.right + 2 ||
      b.y < safe.top - 2 ||
      b.y + b.height > safe.bottom + 2;
    // Only text that has arrived counts: one still flying in may cross the edge.
    if (outside && t.t >= 0.6)
      once(
        `safe:${t.text}`,
        `"${t.text}" leaves the safe area at ${t.t.toFixed(1)} s (keep words 6% from the sides, 10% from the top and 18% from the bottom).`,
      );
    if (t.fontSize < width * MIN_FONT_FRACTION)
      once(
        `small:${t.text}`,
        `"${t.text}" is too small to read (${Math.round(t.fontSize)} px; at least ${Math.ceil(width * MIN_FONT_FRACTION)} px).`,
      );
  }
  for (const line of doc.copy) {
    const missing = normal(line)
      .split(" ")
      .filter((w) => w && !seenWords.has(w));
    if (missing.length > Math.max(1, Math.floor(normal(line).split(" ").length / 3)))
      once(
        `unseen:${line}`,
        `"${line}" never shows clearly on screen; show every copy line long enough to read.`,
      );
  }
  if (page.lastMotion > seconds - END_HOLD_SECONDS + 0.05)
    issues.push(
      page.lastMotion === Infinity
        ? `An animation never ends; every animation must finish by ${(seconds - END_HOLD_SECONDS).toFixed(1)} s (no infinite loops).`
        : `Something still moves at ${page.lastMotion.toFixed(1)} s; everything must finish by ${(seconds - END_HOLD_SECONDS).toFixed(1)} s and hold.`,
    );
  for (const c of page.contrasts)
    if (c.ratio < 3)
      once(
        `contrast:${c.text}`,
        `"${c.text}" is hard to read against what is behind it (contrast ${c.ratio.toFixed(1)}:1; make it at least 4.5:1).`,
      );
  return issues;
}

/* ──────────────────────────────── colour ──────────────────────────────── */

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of an sRGB colour. */
export function luminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse "rgb(…)" / "rgba(…)" from getComputedStyle. */
export function parseRgb(value: string): [number, number, number] | null {
  const m = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
