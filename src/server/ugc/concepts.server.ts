// The Creator video writer: turns product facts + Brand DNA + the brief into
// three video ideas, each a real kind of Reel (a library format, ADR-0046)
// with its hook, story beats, cuts, who says what, the hook text drawn on the
// video and the post caption; and rewrites a script on request.
//
// The model writes; code decides. Formats and their variants (place, twist,
// opening) are picked by code before the call, so ideas never repeat the
// brand's last ones. Ids and timings are normalised, dialogue is sized to the
// clip, every specific claim is checked against the product facts, and
// `formatScriptIssues` checks the craft (hook, story shape, cuts, cast,
// product mentions). A script that fails gets one repair pass; anything still
// wrong is shown to the person as a warning before they spend on a video.
import "server-only";
import { llmText } from "@/lib/ai-gateway.server";
import { serializeBrandContext, type BrandCtxDna } from "@/lib/ai/brand-context";
import { checkScriptClaims, validFactIds, type ClaimWarning } from "@/lib/ugc/grounding";
import {
  craftRules,
  formatExample,
  formatScriptIssues,
  leadRole,
  pickVariants,
  suggestFormats,
  ugcFormat,
  variantOf,
  type FormatVariant,
  type UgcFormat,
} from "@/lib/ugc/formats";
import { hookTextPreset } from "@/lib/ugc/hook-text";
import {
  CTA_PRESETS,
  LANGUAGES,
  OBJECTIVES,
  TONES,
  labelOf,
  platformPreset,
} from "@/lib/ugc/options";
import {
  dialogueWordBudget,
  fitScenes,
  productDisplayName,
  scriptWordCount,
} from "@/lib/ugc/prompt";
import {
  ConceptSchema,
  ScriptSchema,
  type Brief,
  type Concept,
  type Product,
  type Script,
} from "@/lib/ugc/schemas";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { HttpError } from "@/server/http-error";
import { log } from "@/server/observability/logger";

export type WorkspaceProfile = { industry?: string | null; audience?: string | null };

/** What the brand made lately: openings not to repeat and variants to rotate past. */
export type RecentCreatorWork = {
  /** Newest first. */
  hooks: string[];
  /** Per format id, newest first. */
  variants: Record<string, FormatVariant[]>;
};

export type ConceptContext = {
  product: Product;
  brief: Brief;
  brand: Record<string, unknown>;
  workspace: WorkspaceProfile;
  durationSec: number;
  /** The brand's look: writing and video style for this project (styleBlockFor "ugc"). */
  styleText?: string;
  /** What the team told Mellox to remember (memoryBlockFor). "" when none. */
  memoryText?: string;
  recent?: RecentCreatorWork;
  /** Seeds the variant picks (the project id plus a counter); random when absent. */
  seed?: string;
};

export type Completer = typeof llmText;

/** One idea to write: its format and the variant code picked for it. */
type Slot = { format: UgcFormat; variant: FormatVariant };

/**
 * The formats and variants for three ideas. A chosen format gets three
 * different variants of itself; Auto gets three suggested formats from
 * different groups.
 */
export function planSlots(ctx: ConceptContext, count = 3): Slot[] {
  const seed = ctx.seed ?? crypto.randomUUID();
  const chosen = ctx.brief.format !== "auto" ? ugcFormat(ctx.brief.format) : null;
  const recent = (id: string) => ctx.recent?.variants[id] ?? [];
  if (chosen)
    return pickVariants(chosen, seed, recent(chosen.id), count).map((variant) => ({
      format: chosen,
      variant,
    }));
  const ids = suggestFormats(
    {
      industry: ctx.workspace.industry,
      audience: ctx.brief.audience || ctx.workspace.audience,
      product: [
        ctx.product.name,
        ctx.product.category,
        ctx.product.description,
        ...ctx.product.useCases,
      ],
      objective: ctx.brief.objective,
    },
    count,
  );
  return ids
    .map((id) => ugcFormat(id))
    .filter((f): f is UgcFormat => !!f)
    .map((format, i) => ({
      format,
      variant: pickVariants(format, `${seed}:${i}`, recent(format.id), 1)[0],
    }));
}

const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "start",
    "end",
    "role",
    "speaker",
    "cut",
    "shot",
    "action",
    "dialogue",
    "productPlacement",
    "caption",
  ],
  properties: {
    start: { type: "number" },
    end: { type: "number" },
    role: { type: "string", enum: ["hook", "setup", "turn", "payoff", "button"] },
    speaker: {
      type: "string",
      enum: ["A", "B", "none"],
      description: "Who speaks in this beat: role A, role B, or nobody.",
    },
    cut: {
      type: "string",
      enum: ["open", "hard", "split", "continuous"],
      description: "How the beat starts: the first shot is 'open' or 'split'.",
    },
    shot: { type: "string", description: "Camera framing, e.g. 'medium close-up of the guest'." },
    action: { type: "string", description: "What happens: the move, the look, the reaction." },
    dialogue: { type: "string", description: "Exact spoken words, or empty." },
    productPlacement: { type: "string", description: "How the product is seen, or empty." },
    caption: { type: "string", description: "Leave empty." },
  },
} as const;

const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hook", "onScreen", "replyTo", "scenes", "cta", "postCaption", "hashtags", "factIds"],
  properties: {
    hook: { type: "string", description: "The first spoken line, or the first moment." },
    onScreen: {
      type: "string",
      description: "The hook text drawn on the video, 8 words or fewer.",
    },
    replyTo: {
      type: "string",
      description: "Only for a reply-to-a-comment video: the comment. Otherwise empty.",
    },
    scenes: { type: "array", items: SCENE_SCHEMA },
    cta: { type: "string" },
    postCaption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    factIds: { type: "array", items: { type: "string" } },
  },
} as const;

function conceptsSchema(formatIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["concepts"],
    properties: {
      concepts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "angle", "format", "hooks", "whyItWorks", "script"],
          properties: {
            title: { type: "string" },
            angle: { type: "string" },
            format: { type: "string", enum: [...new Set(formatIds)] },
            hooks: { type: "array", items: { type: "string" } },
            whyItWorks: { type: "string" },
            script: SCRIPT_SCHEMA,
          },
        },
      },
    },
  };
}

/** A format and its variant, written as a director's brief for the writer. */
export function formatBrief(
  format: UgcFormat,
  variantIds: FormatVariant | undefined,
  durationSec: number,
): string {
  const v = variantOf(format, variantIds);
  const preset = hookTextPreset(format.hookText.preset);
  const lead = leadRole(format);
  let at = 0;
  const beats = format.beats.map((b) => {
    const from = Math.round(at * durationSec * 10) / 10;
    at += b.share;
    const to = Math.round(at * durationSec * 10) / 10;
    return `  - ${from}-${to}s ${b.role.toUpperCase()} (${b.cut}${b.speaker !== "none" ? `, ${b.speaker} speaks` : ", no speech"}): ${b.shot}. ${b.action}.`;
  });
  const cast = format.roles.length
    ? format.roles
        .map(
          (r) =>
            `  - ${r.key} = ${r.title}${r.key === lead && format.roles.length === 2 ? " (the creator the marketer picked)" : ""}, ${r.position}: ${r.behaviour}.`,
        )
        .join("\n")
    : "  - Hands only, nobody on camera.";
  return `FORMAT: ${format.label} (${format.id}): ${format.show}.
Camera: ${format.camera}. Edit: ${format.edit}. Speech: ${format.speech}.
Cast:
${cast}
Place for this idea: ${v.place.label}: ${v.place.set}. ${v.place.light}.
Twist for this idea: ${v.twist.idea}.
Opening pattern to adapt (never copy it word for word if it doesn't fit): ${v.hook}
Beat template (shape and rhythm; adjust timings to the words):
${beats.join("\n")}
The product: ${format.productRole}.
Hook text style: ${preset.label} (${preset.hint})${preset.split ? ', written as "left / right"' : ""}, like "${format.hookText.example}".
Post caption: ${format.caption}.`;
}

function systemPrompt(ctx: ConceptContext, slots: Slot[]): string {
  const budget = dialogueWordBudget(ctx.durationSec);
  const language = labelOf(LANGUAGES, ctx.brief.language);
  const rules = craftRules(slots[0].format, ctx.brief.objective);
  const examples = [...new Map(slots.map((s) => [s.format.id, s.format])).values()]
    .map(
      (f) =>
        `REFERENCE (${f.label}): a finished video in this format. Copy its rhythm, restraint and timing, never its words.\n${formatExample(f.id)}`,
    )
    .join("\n\n");
  return `You write viral short-form videos for Instagram Reels and TikTok: the kind real creators film on their phone and people send to their friends. You are a sharp comedy and story writer, not an advertiser.
${UNTRUSTED_DATA_RULE}

Each video is ${ctx.durationSec} seconds, filmed on a phone. Longer videos are made from connected clips; keep every person, their clothes, the place and the product the same.

RULES
${rules.map((r) => `- ${r}`).join("\n")}
- Spoken words across ALL beats total at most ${budget}, in ${language}.
- Beats: start/end seconds covering 0 to ${ctx.durationSec}, in order. Follow the format's beat template; ${ctx.durationSec > 15 ? "5 to 8" : "3 to 6"} beats.
- speaker is the role (A or B) who talks in that beat, or "none". cut says how the beat starts.
- Claims: only the product facts provided. Every specific claim (numbers, results, timeframes, certifications, rankings, guarantees, prices, medical effects) must come from a fact; list the ids you relied on in factIds. If a fact isn't provided, don't claim it. Never invent features, reviews, statistics or offers.
- Respect the brand voice and the do/don't rules in Brand DNA; the humour never punches down and never names a competitor.
- The video itself shows no words; onScreen is the hook text code draws on it.
- hooks: 3 alternative opening lines for the idea (the script's hook is the best one).
- hashtags without "#".

${examples}`;
}

function userPrompt(ctx: ConceptContext, extra: string): string {
  const { product, brief } = ctx;
  const platform = platformPreset(brief.platform);
  const brandContext = serializeBrandContext(ctx.brand as BrandCtxDna, { maxCharsPerField: 400 });
  const facts = product.facts.map((f) => ({ id: f.id, fact: f.text }));
  const recentHooks = (ctx.recent?.hooks ?? []).slice(0, 10);
  return `PRODUCT
${wrapUntrusted(
  "product",
  JSON.stringify(
    {
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price,
      description: product.description,
      facts,
      benefits: product.benefits,
      audience: product.audienceHints,
      useCases: product.useCases,
    },
    null,
    2,
  ),
  { maxChars: 8000, route: "ugc.concepts" },
)}

BRIEF
- Objective: ${labelOf(OBJECTIVES, brief.objective)}
- Platform: ${platform.label}
- Mood: ${labelOf(TONES, brief.tone)}
- Language: ${labelOf(LANGUAGES, brief.language)}
- Target audience: ${brief.audience || ctx.workspace.audience || product.audienceHints.join("; ") || "infer from the product"}
- If a call to action is spoken at all, its idea: ${brief.cta || CTA_PRESETS[brief.objective][0]} (said like a person, never as written)
${brief.instructions ? `- Creative notes from the marketer: ${brief.instructions}` : ""}
${ctx.workspace.industry ? `- Industry: ${ctx.workspace.industry}` : ""}
${recentHooks.length ? `\nOPENINGS THIS BRAND ALREADY USED (never open the same way or with the same words):\n${recentHooks.map((h) => `- ${h}`).join("\n")}\n` : ""}
${brandContext ? wrapUntrusted("brand dna", brandContext, { maxChars: 4000, route: "ugc.concepts" }) : "No Brand DNA saved."}
${ctx.styleText ? `\nBRAND STYLE (write the dialogue, hooks and post caption in this style; facts still come only from the product facts)\n${wrapUntrusted("brand style", ctx.styleText, { maxChars: 3000, route: "ugc.concepts" })}\n` : ""}
${ctx.memoryText ? `\n${ctx.memoryText}\nFacts still come only from the product facts.\n` : ""}
${extra}`;
}

type RawScene = Record<string, unknown>;
type RawScript = {
  hook?: string;
  onScreen?: string;
  replyTo?: string;
  scenes?: RawScene[];
  cta?: string;
  postCaption?: string;
  hashtags?: string[];
  factIds?: string[];
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

/** Normalise model output into a valid Script sized to the clip, or null. */
export function normalizeScript(
  raw: RawScript,
  ctx: ConceptContext,
  slot?: { format: UgcFormat; variant?: FormatVariant },
): Script | null {
  const max = slot ? 8 : 6;
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).slice(0, max).map((s, i) => ({
    id: `s${i + 1}`,
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    shot: String(s.shot ?? "").slice(0, 300),
    action: String(s.action ?? "").slice(0, 500),
    dialogue: slot?.format.speech === "none" ? "" : String(s.dialogue ?? "").slice(0, 400),
    productPlacement: String(s.productPlacement ?? "").slice(0, 300),
    caption: "",
    ...(slot
      ? {
          speaker:
            oneOf(s.speaker, ["A", "B", "none"] as const) ??
            (slot.format.roles.length ? ("A" as const) : ("none" as const)),
          cut:
            oneOf(s.cut, ["open", "hard", "split", "continuous"] as const) ??
            (i === 0 ? ("open" as const) : ("hard" as const)),
          role: oneOf(s.role, ["hook", "setup", "turn", "payoff", "button"] as const),
        }
      : {}),
  }));
  if (!scenes.length) return null;
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
  const onScreen = String(raw.onScreen ?? "").trim();
  const parsed = ScriptSchema.safeParse({
    hook: String(raw.hook ?? scenes[0].dialogue ?? "").slice(0, 200) || "Hook",
    scenes: fitScenes(
      scenes.map((s) => ({ ...s, end: s.end > s.start ? s.end : s.start + 1 })),
      ctx.durationSec,
    ),
    cta: String(raw.cta ?? ctx.brief.cta ?? "").slice(0, 120),
    postCaption: String(raw.postCaption ?? "").slice(0, 600),
    hashtags: (Array.isArray(raw.hashtags) ? raw.hashtags : [])
      .map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "").slice(0, 40))
      .filter(Boolean)
      .slice(0, 10),
    factIds: validFactIds(
      Array.isArray(raw.factIds) ? raw.factIds.map(String) : [],
      ctx.product.facts,
    ),
    ...(slot
      ? {
          format: slot.format.id,
          ...(slot.variant ? { variant: slot.variant } : {}),
          // Kept only when it fits on screen; the checks name it if it didn't.
          onScreen: words(onScreen).length <= 10 ? onScreen.slice(0, 80) : "",
          replyTo: String(raw.replyTo ?? "").slice(0, 120),
        }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

function scriptWarnings(script: Script, ctx: ConceptContext): string[] {
  const warnings = checkScriptClaims(script, ctx.product.facts).map((w: ClaimWarning) => w.message);
  const words = scriptWordCount(script, ctx.brief.language);
  const budget = dialogueWordBudget(ctx.durationSec);
  if (words > budget + 3) {
    warnings.push(
      `The dialogue is ${words} words; about ${budget} fit in ${ctx.durationSec} seconds. Trim it so nobody is rushed.`,
    );
  }
  const format = ugcFormat(script.format);
  if (format)
    warnings.push(
      ...formatScriptIssues(script, format, {
        productName: productDisplayName(ctx.product),
        recentHooks: ctx.recent?.hooks,
      }),
    );
  return warnings;
}

async function complete(
  completer: Completer,
  ctx: ConceptContext,
  slots: Slot[],
  extra: string,
  schema: Record<string, unknown>,
  maxTokens: number,
): Promise<unknown> {
  const result = await completer({
    route: "ugc.concepts",
    system: systemPrompt(ctx, slots),
    user: userPrompt(ctx, extra),
    maxTokens,
    outputSchema: schema,
    temperature: 0.9,
    timeoutMs: 120_000,
    retries: 1,
  });
  if (result.truncated) throw new HttpError(502, "The ideas were cut off. Please try again.");
  try {
    return JSON.parse(result.text);
  } catch {
    throw new HttpError(502, "The ideas couldn't be read. Please try again.");
  }
}

type RawConcept = {
  title?: string;
  angle?: string;
  format?: string;
  hooks?: string[];
  whyItWorks?: string;
  script?: RawScript;
};

function toConcepts(raw: unknown, ctx: ConceptContext, slots: Slot[]): Concept[] {
  const list = ((raw as { concepts?: RawConcept[] })?.concepts ?? []).slice(0, slots.length);
  const out: Concept[] = [];
  list.forEach((c, i) => {
    // The slot code planned decides the format, whatever the model wrote.
    const slot = slots[i] ?? slots[0];
    const script = c.script ? normalizeScript(c.script, ctx, slot) : null;
    if (!script) return;
    const hooks = [script.hook, ...(Array.isArray(c.hooks) ? c.hooks.map(String) : [])]
      .map((h) => h.trim().slice(0, 200))
      .filter(
        (h, idx, all) => h && all.findIndex((x) => x.toLowerCase() === h.toLowerCase()) === idx,
      )
      .slice(0, 5);
    const parsed = ConceptSchema.safeParse({
      id: `c${i + 1}`,
      title: String(c.title ?? `Idea ${i + 1}`).slice(0, 120),
      angle: String(c.angle ?? "").slice(0, 400),
      format: slot.format.id,
      hooks,
      whyItWorks: String(c.whyItWorks ?? "").slice(0, 400),
      script,
      warnings: scriptWarnings(script, ctx).slice(0, 10),
    });
    if (parsed.success) out.push(parsed.data);
  });
  return out;
}

function slotsText(slots: Slot[], durationSec: number): string {
  return slots
    .map((s, i) => `IDEA ${i + 1}\n${formatBrief(s.format, s.variant, durationSec)}`)
    .join("\n\n");
}

export async function generateConcepts(
  ctx: ConceptContext,
  completer: Completer = llmText,
): Promise<Concept[]> {
  const slots = planSlots(ctx);
  const schema = conceptsSchema(slots.map((s) => s.format.id));
  const raw = await complete(
    completer,
    ctx,
    slots,
    `Write ${slots.length} ideas, in this order, each in its own format, place and twist:

${slotsText(slots, ctx.durationSec)}

Each idea has a different hook strategy and a different payoff. Make people want to watch it twice and send it to a friend.`,
    schema,
    9000,
  );
  let concepts = toConcepts(raw, ctx, slots);
  if (!concepts.length) throw new HttpError(502, "No usable ideas came back. Please try again.");

  const flagged = concepts.filter((c) => c.warnings.length);
  if (flagged.length) {
    log.info("ugc.concepts.repair", { flagged: flagged.length });
    const repairs = flagged.map((c) => `${c.title}:\n- ${c.warnings.join("\n- ")}`).join("\n\n");
    try {
      const repaired = toConcepts(
        await complete(
          completer,
          ctx,
          slots,
          `Your previous ideas had problems. Rewrite ALL ${concepts.length} ideas in the same order and formats, keeping what works, and fix these issues:
${repairs}

${slotsText(slots, ctx.durationSec)}

Previous ideas (JSON):
${JSON.stringify({ concepts: concepts.map(({ id: _id, warnings: _w, ...c }) => c) })}`,
          schema,
          9000,
        ),
        ctx,
        slots,
      );
      const before = concepts.reduce((n, c) => n + c.warnings.length, 0);
      const after = repaired.reduce((n, c) => n + c.warnings.length, 0);
      if (repaired.length >= concepts.length && after < before) concepts = repaired;
    } catch (error) {
      log.warn("ugc.concepts.repair_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // With one format chosen, the cleanest idea comes first (the one the composer loads).
  if (ctx.brief.format !== "auto")
    concepts = concepts
      .map((c, i) => ({ c, i }))
      .sort((a, b) => a.c.warnings.length - b.c.warnings.length || a.i - b.i)
      .map(({ c }, i) => ({ ...c, id: `c${i + 1}` }));
  return concepts;
}

export async function rewriteScript(
  ctx: ConceptContext,
  script: Script,
  instruction: string,
  completer: Completer = llmText,
): Promise<{ script: Script; warnings: string[] }> {
  const format =
    ugcFormat(script.format) ?? (ctx.brief.format !== "auto" ? ugcFormat(ctx.brief.format) : null);
  const slots: Slot[] = format
    ? [{ format, variant: script.variant ?? pickVariants(format, ctx.seed ?? "rewrite", [], 1)[0] }]
    : planSlots(ctx, 1);
  const raw = await complete(
    completer,
    ctx,
    slots,
    `Rewrite this script for a ${ctx.durationSec}-second video. Instruction from the marketer: "${instruction.slice(0, 300)}"
Keep what works, apply the instruction, and keep every rule above.

${formatBrief(slots[0].format, slots[0].variant, ctx.durationSec)}

Current script (JSON):
${JSON.stringify(script)}`,
    SCRIPT_SCHEMA as unknown as Record<string, unknown>,
    3500,
  );
  const next = normalizeScript(raw as RawScript, ctx, slots[0]);
  if (!next) throw new HttpError(502, "The rewrite couldn't be read. Please try again.");
  return { script: next, warnings: scriptWarnings(next, ctx) };
}
