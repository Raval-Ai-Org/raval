// Makes one motion graphic: the model designs it as an HTML/SVG + CSS
// document (route studio.motion.compose), code checks it, Chromium draws it
// (render.server.ts). A design that fails the checks is asked for once more
// with the reasons; a second failure fails the piece plainly — no template
// fallback, like photo design.
//
// The caller passes what it has already verified for the workspace: the brand
// context (loadStudioContext: memory, strategy, goal, catalogue), the facts,
// and the logo and photos as data URLs. The look (colours, fonts) is loaded
// here by the verified workspace id.
import "server-only";
import { llmJson } from "@/lib/ai-gateway.server";
import { beatSeconds, musicMood, type MusicMood } from "@/lib/studio/audio/soundtrack";
import {
  MOTION_DOC_JSON_SCHEMA,
  MOTION_MAX_COPY,
  MOTION_MAX_SECONDS,
  MOTION_MIN_SECONDS,
  MotionDocSchema,
  drawnIssues,
  motionPage,
  staticIssues,
  type MotionCanvas,
  type MotionDoc,
} from "@/lib/studio/motion/document";
import {
  END_HOLD_SECONDS,
  MOTION_LAYOUTS,
  motionKnowledge,
  pickMotionLayout,
  type MotionLayoutId,
} from "@/lib/studio/motion/principles";
import { wrapUntrusted } from "@/server/guardrails/untrusted";
import { loadBrandLook } from "@/server/brand-look/resolve.server";
import { log } from "@/server/observability/logger";
import { loadFonts } from "@/server/studio/carousel-render.server";
import { inspectMotion, renderMotion } from "./render.server";

export type MotionRatio = "9:16" | "1:1" | "4:5" | "16:9";

export function motionCanvas(ratio: MotionRatio): MotionCanvas {
  switch (ratio) {
    case "1:1":
      return { width: 1080, height: 1080 };
    case "4:5":
      return { width: 1080, height: 1350 };
    case "16:9":
      return { width: 1920, height: 1080 };
    default:
      return { width: 1080, height: 1920 };
  }
}

export type MotionInput = {
  workspaceId: string;
  brief: string;
  seconds: number;
  ratio: MotionRatio;
  /** loadStudioContext's brand text (name, memory, strategy, goal, catalogue). */
  brandText: string;
  brandName: string;
  /** Everything the brand has stated, for grounding the words. */
  knownFacts: string;
  /** The person's exact words, when they gave them; the copy stays within them. */
  approvedCopy?: string[];
  /** Verified data URLs. */
  logo?: string | null;
  photos?: string[];
  /** Layouts of the brand's latest motion graphics, newest first. */
  recentLayouts?: string[];
  mood?: MusicMood;
  bpm?: number;
  seed: number;
};

export type MotionResult =
  | {
      ok: true;
      video: Buffer;
      samples: Buffer[];
      doc: MotionDoc;
      layout: MotionLayoutId;
      mood: MusicMood;
      attempts: number;
    }
  | { ok: false; reason: string; issues: string[]; attempts: number };

const SYSTEM = `You are a senior motion designer making a short social video as ONE HTML/SVG + CSS document.

How it is drawn: the document is placed inside #stage, a fixed box exactly the video's size. Chromium draws it frame by frame by moving the CSS animations; there is no JavaScript and nothing loads from outside. So:
- Animate only with CSS @keyframes and animation properties (delays, easing, fill-mode both/forwards). No transitions that need hover or a class change.
- No <script>, no event attributes, no <style>/<link> tags in the markup (put every style in "css"), no src/href addresses, no url() except an SVG #id, no @import or @font-face.
- Draw shapes with CSS and inline SVG. Use position:absolute inside #stage freely; size with px based on the canvas given, or with % of the stage.
- Colours: var(--brand-primary), var(--brand-secondary), var(--brand-accent), var(--brand-background), var(--brand-text) (each may be missing: give a fallback, e.g. var(--brand-accent, #fff)).
- Type: font-family var(--font-heading) for headlines and var(--font-body) for the rest.
- Real brand pictures go only in named slots: <img data-slot="logo" class="..."> and <img data-slot="photo-1">. Never draw a logo, a product or a person yourself, and never give an <img> a src.
- Every animation must end (no infinite iteration) and everything is still for the end hold.
- "copy" lists every piece of text that appears on screen, exactly as written in the markup. Nothing else may be visible text.
- Never invent a figure, price, date, claim, review or quote: use only what the brand's facts and the brief say.

Answer with JSON: { "scenes": [{ "start", "end", "does" }], "copy": [...], "html": "...", "css": "..." }.`;

async function fontFaces(heading: string, body: string): Promise<string> {
  const faces = await loadFonts([heading, body]).catch(() => []);
  return faces
    .map(
      (f) =>
        `@font-face{font-family:"${f.name.replace(/["\\]/g, "")}";src:url(data:font/ttf;base64,${Buffer.from(f.data).toString("base64")});font-weight:${f.weight};font-style:${f.style};font-display:block;}`,
    )
    .join("\n");
}

function userPrompt(
  input: MotionInput,
  args: {
    layout: MotionLayoutId;
    canvas: MotionCanvas;
    mood: MusicMood;
    beat: number;
    lookText: string;
    previous?: { doc: MotionDoc | null; issues: string[] };
  },
): string {
  const slots = [
    input.logo
      ? '- data-slot="logo": the brand logo (keep it whole, never stretch it; give it a width and height:auto).'
      : "- No logo: end on the brand name set in type.",
    ...(input.photos ?? []).map(
      (_, i) =>
        `- data-slot="photo-${i + 1}": a real photo of the brand's (object-fit is contain; never crop a product).`,
    ),
  ];
  const parts = [
    `## The video`,
    `- Canvas ${args.canvas.width} x ${args.canvas.height} px (${input.ratio}), ${input.seconds} s, ${MOTION_LAYOUTS.length} layouts known; this one is chosen below.`,
    `- Brand: ${input.brandName}`,
    "",
    "## Brief",
    wrapUntrusted("brief", input.brief),
    input.approvedCopy?.length
      ? `\n## Exact words to use (no other words)\n${input.approvedCopy.map((l) => `- ${l}`).join("\n")}`
      : `\n## Words\nWrite at most ${MOTION_MAX_COPY} short lines yourself from the brief and the brand's facts; end with a short call to action.`,
    "",
    "## Brand",
    input.brandText,
    args.lookText ? `\n## Brand look\n${args.lookText}` : "",
    "",
    "## Slots",
    ...slots,
    "",
    motionKnowledge({
      layout: args.layout,
      seconds: input.seconds,
      mood: args.mood,
      beat: args.beat,
    }),
  ];
  if (args.previous) {
    parts.push(
      "",
      "## Your previous design could not be used",
      ...args.previous.issues.map((i) => `- ${i}`),
      "Make a corrected design that keeps what worked and fixes every point.",
    );
  }
  return parts.join("\n");
}

/** One design call; null when the answer isn't a usable document. */
async function design(system: string, user: string): Promise<MotionDoc | null> {
  const raw = await llmJson<unknown>({
    route: "studio.motion.compose",
    system,
    user,
    outputSchema: MOTION_DOC_JSON_SCHEMA as unknown as Record<string, unknown>,
    fallback: null,
  });
  const parsed = MotionDocSchema.safeParse(raw);
  if (!parsed.success && raw) {
    // Which fields were wrong, so a model that keeps missing one is visible.
    log.warn("studio.motion.unusable_doc", {
      issues: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  return parsed.success ? parsed.data : null;
}

/** Design, check and draw one motion graphic. Two design calls at most. */
export async function makeMotionGraphic(input: MotionInput): Promise<MotionResult> {
  const seconds = Math.min(
    MOTION_MAX_SECONDS,
    Math.max(MOTION_MIN_SECONDS, Math.round(input.seconds)),
  );
  const canvas = motionCanvas(input.ratio);
  const { look } = await loadBrandLook(input.workspaceId);
  const heading = look.visual.typography?.heading || "Inter";
  const body = look.visual.typography?.body || heading;
  const mood =
    input.mood ?? musicMood(`${look.video?.music ?? ""} ${look.visual.mood ?? ""} ${input.brief}`);
  const beat = beatSeconds(mood, input.bpm);
  const layout = pickMotionLayout({
    brief: input.brief,
    hasProductPhoto: Boolean(input.photos?.length),
    hasFigure: /\d/.test(input.approvedCopy?.join(" ") ?? ""),
    recent: input.recentLayouts,
    seed: input.seed,
  });
  const faces = await fontFaces(heading, body);
  const slots: Record<string, string> = {};
  if (input.logo) slots.logo = input.logo;
  (input.photos ?? []).slice(0, 4).forEach((p, i) => (slots[`photo-${i + 1}`] = p));
  const checkContext = {
    seconds,
    knownFacts: `${input.knownFacts}\n${input.brief}\n${input.brandName}`,
    approvedCopy: input.approvedCopy,
    slots: { logo: Boolean(input.logo), photos: Math.min(4, input.photos?.length ?? 0) },
  };
  const lookText = [
    look.visual.palette.primary ? `Primary colour ${look.visual.palette.primary}.` : "",
    `Heading font ${heading}, body font ${body}.`,
    look.visual.typography?.casing && look.visual.typography.casing !== "as-written"
      ? `Headings set in ${look.visual.typography.casing} case.`
      : "",
    look.visual.typography?.tracking ? `Letter spacing ${look.visual.typography.tracking}.` : "",
    look.visual.mood ? `Visual mood: ${look.visual.mood}.` : "",
    look.video?.pacing ? `Video pacing: ${look.video.pacing}.` : "",
    look.writing?.voice ? `Voice: ${look.writing.voice}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  let previous: { doc: MotionDoc | null; issues: string[] } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const doc = await design(
      SYSTEM,
      userPrompt({ ...input, seconds }, { layout, canvas, mood, beat, lookText, previous }),
    );
    if (!doc) {
      previous = {
        doc: null,
        issues: ["The answer was not a complete document with scenes, copy, html and css."],
      };
      continue;
    }
    let issues = staticIssues(doc, checkContext);
    const page = motionPage({
      doc,
      canvas,
      palette: look.visual.palette,
      fontFaces: faces,
      fonts: { heading, body },
      slots,
    });
    if (!issues.length) {
      try {
        issues = drawnIssues(await inspectMotion(page, canvas, seconds), doc, seconds);
      } catch (error) {
        log.warn("studio.motion.inspect_failed", { error: String(error).slice(0, 300) });
        return {
          ok: false,
          reason: "The video could not be drawn.",
          issues: [],
          attempts: attempt,
        };
      }
    }
    if (issues.length) {
      log.info("studio.motion.redesign", { attempt, issues: issues.slice(0, 8) });
      previous = { doc, issues };
      continue;
    }
    const { video, samples } = await renderMotion(page, canvas, seconds);
    return { ok: true, video, samples, doc, layout, mood, attempts: attempt };
  }
  return {
    ok: false,
    reason: "The design didn't pass the checks twice, so nothing was made.",
    issues: previous?.issues ?? [],
    attempts: 2,
  };
}

/** How long the piece holds at the end, for callers placing an end card or sound. */
export const MOTION_END_HOLD = END_HOLD_SECONDS;
