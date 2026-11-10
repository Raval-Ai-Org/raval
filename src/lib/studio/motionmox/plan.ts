// Which MotionMox elements go into a person's video, when and where. Code
// decides everything here; the words come only from the approved copy, the
// brand's name or words the person quoted. Pure and browser-safe.
import type { CopyLine } from "../creative-knowledge";
import type { Transition } from "../smart-cut";
import {
  MOTIONMOX_ELEMENTS,
  MOTIONMOX_SAFE,
  quotedPhrases,
  readSeconds,
  type MotionMoxElementId,
} from "./elements";
import {
  MOTIONMOX_FPS,
  specSeconds,
  type MotionMoxSegment,
  type MotionMoxSpec,
  type MotionMoxTransition,
} from "./spec";

export type MotionMoxPlanInput = {
  canvas: { width: number; height: number };
  /** The pieces in order, already cut and fitted by code; the last is the end card when there is one. */
  segments: MotionMoxSegment[];
  endCard: boolean;
  transition: Transition;
  transitionSeconds: number;
  copy: CopyLine[];
  endCopy: CopyLine[];
  brief: string;
  brandName: string;
  /** What the person picked or asked for. Empty: the usual video (designed opening, logo, end card). */
  asked: MotionMoxElementId[];
  /** The designed opening PNG, when one was made. */
  overlay: string | null;
  overlaySeconds: number;
  captions: MotionMoxSpec["captions"];
  logo: string | null;
  colours: string[];
  font: string | null;
};

export type MotionMoxPlan = {
  spec: MotionMoxSpec;
  /** Every line a text element may show; groundSpec drops anything else. */
  allowedText: string[];
  /** Plain notes for the person about anything asked for that couldn't be added. */
  notes: string[];
};

const TRANSITIONS: Record<Transition, MotionMoxTransition> = {
  fade: "fade",
  smoothleft: "slide-left",
  smoothup: "slide-up",
};

const PRICE =
  /(?:rs\.?|pkr|usd|eur|gbp|aed|sar|inr|[$€£₹])\s?\d[\d,.]*|\d[\d,.]*\s?(?:rs|pkr|usd|eur|gbp|aed|sar|inr)\b|\d{1,3}\s?%\s?off/i;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function hex(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v))
    return `#${v
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`.toLowerCase();
  return fallback;
}

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink, paper and accent from the brand's colours; always readable (ink on paper). */
export function motionMoxLook(colours: string[], font: string | null): MotionMoxSpec["look"] {
  const valid = colours.map((c) => hex(c, "")).filter(Boolean);
  const accent =
    valid.find((c) => {
      const l = luminance(c);
      return l > 0.05 && l < 0.85;
    }) ??
    valid[0] ??
    "#c6f432";
  const dark = valid.find((c) => luminance(c) < 0.05) ?? "#111111";
  const light = valid.find((c) => luminance(c) > 0.85) ?? "#ffffff";
  return { ink: dark, paper: light, accent, font: font?.trim() || null };
}

/** Plan the video. The result still goes through groundSpec before it is drawn. */
export function planMotionMox(input: MotionMoxPlanInput): MotionMoxPlan {
  const notes: string[] = [];
  // The usual video always keeps the brand's logo, its end card and the
  // captions the server heard (it only passes cues when captions are wanted).
  const asked = new Set<MotionMoxElementId>(input.asked);
  if (input.logo) asked.add("logo-bug");
  if (input.endCard) asked.add("end-card");
  if (input.captions.length) asked.add("captions");
  if (input.asked.includes("captions") && !input.captions.length)
    notes.push("Captions were left out: nobody can be heard talking in the clips.");

  const transition = input.segments.length > 1 ? TRANSITIONS[input.transition] : "none";
  const base = {
    segments: input.segments,
    transition,
    transitionSeconds: transition === "none" ? 0 : input.transitionSeconds,
  } as const;
  const total = specSeconds(base);
  const endCardSeconds = input.endCard ? input.segments[input.segments.length - 1].seconds : 0;
  /** Words stop before the end card, which carries its own design. */
  const textEnd = Math.max(1, total - endCardSeconds);

  const lines = input.copy
    .map((l) => ({ label: l.label.toLowerCase(), text: clean(l.text) }))
    .filter((l) => l.text);
  const quoted = quotedPhrases(input.brief);
  const allowedText = [
    ...lines.map((l) => l.text),
    ...input.endCopy.map((l) => clean(l.text)),
    ...quoted,
    clean(input.brandName),
  ].filter(Boolean);
  const used = new Set<string>();
  const take = (pick: (text: string, label: string) => boolean, max: number) => {
    for (const l of lines)
      if (!used.has(l.text) && words(l.text) <= max && pick(l.text, l.label)) {
        used.add(l.text);
        return l.text;
      }
    for (const q of quoted)
      if (!used.has(q) && words(q) <= max && pick(q, "quoted")) {
        used.add(q);
        return q;
      }
    return null;
  };

  const texts: MotionMoxSpec["texts"] = [];
  const place = (element: MotionMoxElementId, text: string, from: number, hold?: number) => {
    const el = MOTIONMOX_ELEMENTS[element];
    const to = Math.min(
      textEnd,
      from + el.enter + (hold ?? readSeconds(words(text)) + 1) + el.exit,
    );
    if (to - from >= 0.8) texts.push({ element, text, from, to });
  };

  // The designed opening already carries the headline and its line.
  const animateHeadline = asked.has("headline") || (!input.overlay && lines.length > 0);
  if (animateHeadline) {
    const headline =
      take((_t, label) => label.includes("headline") || label.includes("title"), 8) ??
      take(() => true, 8);
    if (headline)
      place("headline", headline, 0.3, Math.min(textEnd * 0.5, readSeconds(words(headline)) + 1.5));
    else notes.push("No headline was written for this video, so none was added.");
  }
  if (asked.has("badge")) {
    const badge = take(
      (t, label) => label.includes("badge") || label.includes("tag") || words(t) <= 3,
      3,
    );
    if (badge) place("badge", badge, 0.6, Math.min(textEnd * 0.5, 3));
  }
  if (asked.has("lower-third")) {
    const line = take((_t, label) => !label.includes("headline"), 10);
    if (line) place("lower-third", line, Math.min(textEnd * 0.35, 2.2));
  }
  if (asked.has("price-tag")) {
    const price = take((t) => PRICE.test(t), 4);
    if (price) place("price-tag", price, Math.max(0.8, textEnd * 0.45), 2.6);
    else
      notes.push(
        "No price was given, so no price tag was added. Write the price in your brief to show it.",
      );
  }
  if (asked.has("cta")) {
    const cta = take(
      (t, label) =>
        /cta|button|action|call/.test(label) ||
        label === "quoted" ||
        /\b(shop|buy|order|book|call|visit|sign up|link in bio|learn more|try)\b/i.test(t),
      4,
    );
    if (cta) {
      const hold = Math.min(3, Math.max(1.6, textEnd * 0.25));
      place("cta", cta, Math.max(0.5, textEnd - hold - 0.8), hold);
    } else
      notes.push(
        'No button words were given, so no button was added. Put them in quotes, like "Shop now".',
      );
  }

  const spec: MotionMoxSpec = {
    version: 1,
    width: input.canvas.width,
    height: input.canvas.height,
    fps: MOTIONMOX_FPS,
    ...base,
    overlay:
      input.overlay && !animateHeadline
        ? { src: input.overlay, from: 0, to: Math.min(input.overlaySeconds, textEnd) }
        : null,
    texts,
    captions: asked.has("captions") ? input.captions : [],
    logo: asked.has("logo-bug") && input.logo ? { src: input.logo, from: 0.4 } : null,
    progressBar: asked.has("progress-bar"),
    look: motionMoxLook(input.colours, input.font),
    safe: { ...MOTIONMOX_SAFE },
  };
  if (asked.has("logo-bug") && !input.logo)
    notes.push("There's no logo in Brand DNA yet, so none was added.");
  return { spec, allowedText, notes };
}

/** Does this video still need the image model's designed opening? (No, when MotionMox animates the words itself.) */
export function wantsDesignedOpening(asked: MotionMoxElementId[]): boolean {
  return !asked.includes("headline");
}
