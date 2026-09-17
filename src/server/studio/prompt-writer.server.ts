// prompt-writer.server.ts — "Write it for me" for Studio descriptions.
//
// Loads what Studio knows about the workspace (brand, recent work, Market
// Brain trends, rising searches, competitor moves, upcoming moments), picks one
// live signal at weighted random plus random creative directions, and asks the
// model for a long, sectioned description tailored to the format. Every call
// bypasses the response cache so repeated clicks give genuinely new ideas.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runStructuredPrompt } from "@/lib/ai";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { collectSignals, type IdeaSource } from "@/lib/studio/ideas";
import type { GoalId, StudioControls } from "@/lib/studio/jobs";
import {
  PROMPT_BLUEPRINTS,
  PROMPT_GOALS,
  PROMPT_MAX_CHARS,
  PROMPT_MIN_CHARS,
  SIGNAL_LABEL,
  cleanPrompt,
  describeSettings,
  pickSignal,
  pickSparks,
  type PromptMode,
} from "@/lib/studio/prompt-writer";
import { sections } from "@/lib/studio/prompts";
import { getTemplate } from "@/lib/studio/templates";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { loadStudioContext } from "./context.server";

const ResultSchema = z.object({
  title: z.coerce.string().min(3),
  prompt: z.coerce.string().min(PROMPT_MIN_CHARS),
  why: z.coerce.string().default(""),
  goal: z
    .enum(["awareness", "engagement", "leads", "launch", "education", "offer"])
    .optional()
    .catch(undefined),
});

export type WrittenPrompt = {
  title: string;
  prompt: string;
  /** One line on what the idea is based on, for the person. */
  why: string;
  /** Which kind of signal it came from ("Trending", "Coming up", …). */
  basedOn: string;
  /** The signal headline, so the client can avoid it next time. */
  signal: string | null;
  goal?: GoalId;
};

export async function writeStudioPrompt(args: {
  client: unknown;
  workspaceId: string;
  brand: Record<string, unknown> | null | undefined;
  type: StudioType;
  current?: string;
  template?: string;
  goal?: GoalId;
  controls?: Partial<StudioControls>;
  /** Titles and signal headlines the person was recently given. */
  avoid?: string[];
}): Promise<WrittenPrompt> {
  const format = STUDIO_FORMATS[args.type];
  const blueprint = PROMPT_BLUEPRINTS[args.type];
  const template = getTemplate(args.template);
  const usableTemplate = template?.types.includes(args.type) ? template : null;
  const current = (args.current ?? "").trim();
  // A template starter with only [blanks] is a structure to fill, not the person's idea.
  const mode: PromptMode =
    current.length >= 12 && !(usableTemplate && current === usableTemplate.starter)
      ? "expand"
      : "fresh";

  const ctx = await loadStudioContext(args.client as SupabaseClient, args.workspaceId, args.brand);
  const signals = collectSignals(ctx, args.brand);
  const avoid = (args.avoid ?? []).slice(0, 30);
  const signal = pickSignal(signals, avoid);
  const sparks = pickSparks(args.type);

  const system = [
    "You are Mellox, a senior creative strategist and prompt writer for marketing teams.",
    `You write the description a person hands to an AI content studio to create a ${format.label.toLowerCase()}. The studio already knows the brand; your description decides how good, specific and timely the result is.`,
    mode === "expand"
      ? "The person has written their own idea. Keep their idea, facts, offers and wording choices at the centre, and turn it into a complete, detailed description. Weave in the timely signal only where it genuinely strengthens their idea."
      : "Invent one fresh, specific, genuinely interesting idea for this brand, anchored on the timely signal provided so it feels current and relevant.",
    `Structure the description as plain labelled sections, each starting on a new line as 'Label: …', in exactly this order: ${blueprint.sections.join(", ")}. Use short bullet lines starting with '- ' inside a section when listing.`,
    blueprint.guidance,
    "Make it long, vivid and complete — typically 250–550 words — so nothing is left for the person to figure out. Every line must be specific to this brand and idea; no filler and no generic marketing phrases ('elevate', 'unlock', 'game-changer', 'in today's fast-paced world').",
    "Write in plain, everyday language, matching the spelling style of the brand context.",
    "Never invent statistics, prices, discounts, deadlines, product sizes or specifications, ingredients, customer names, reviews, awards or events. Use only facts present in the brand context or the person's text; otherwise describe things generally.",
    "Do not repeat or lightly reword anything in the 'Already used' list.",
    UNTRUSTED_DATA_RULE,
    "Return STRICT JSON only.",
    'Schema: {"title": string (a specific working title, ≤ 70 characters), "prompt": string (the full sectioned description), "why": string (≤ 110 characters: what makes this timely or relevant, citing the signal plainly), "goal": "awareness"|"engagement"|"leads"|"launch"|"education"|"offer"}',
  ].join("\n");

  const others = signals
    .filter((s) => s !== signal)
    .slice(0, 5)
    .map((s) => `- [${SIGNAL_LABEL[s.source]}] ${s.headline}`)
    .join("\n");

  const user = sections([
    { label: "Format", body: `${format.label}: ${format.description}` },
    {
      label: "Brand",
      body: wrapUntrusted("brand", ctx.brandText || `Brand: ${ctx.brandName}`, {
        maxChars: 6000,
        route: "studio.prompt",
      }),
    },
    {
      label: "Business",
      body: [
        ctx.industry && `Industry: ${ctx.industry}`,
        ctx.audience && `Audience: ${ctx.audience}`,
        ctx.website && `Website: ${ctx.website}`,
        `Today: ${ctx.today}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      label: "Timely signal to build on",
      body: signal
        ? wrapUntrusted(
            "signal",
            `[${SIGNAL_LABEL[signal.source]}] ${signal.headline} — ${signal.detail}`,
            { maxChars: 600, route: "studio.prompt" },
          )
        : "No live signal available — build on the brand's strongest product, value or audience need.",
    },
    {
      label: "Other things happening (inspiration only)",
      body: others
        ? wrapUntrusted("signals", others, { maxChars: 1500, route: "studio.prompt" })
        : "",
    },
    { label: "Creative direction for this one", body: sparks.map((s) => `- ${s}`).join("\n") },
    { label: "Settings", body: describeSettings(args.type, args.controls) },
    { label: "Goal", body: args.goal ? `The person picked the goal: ${args.goal}.` : "" },
    {
      label: "Template to follow",
      body: usableTemplate
        ? `${usableTemplate.label}: ${usableTemplate.directive}\nStructure: ${usableTemplate.beats.join(" → ")}. Fill every [bracketed] part with specifics.`
        : "",
    },
    {
      label: "The person's idea (keep it)",
      body:
        mode === "expand"
          ? wrapUntrusted("draft", current.slice(0, 2000), { route: "studio.prompt" })
          : "",
    },
    {
      label: "Already used — do not repeat",
      body: [...ctx.recent.slice(0, 12).map((r) => r.title), ...avoid]
        .filter(Boolean)
        .map((t) => `- ${t}`)
        .join("\n"),
    },
    // A per-call token so no two requests are identical upstream.
    { label: "Request", body: `Variation ${Math.random().toString(36).slice(2, 10)}` },
  ]);

  const parsed = await runStructuredPrompt({
    route: "studio.prompt",
    system,
    user,
    schema: ResultSchema,
    maxTokens: 1800,
    temperature: 1,
    noCache: true,
    regenerate: true,
  });

  const source: IdeaSource = signal?.source ?? "pillar";
  return {
    title: parsed.title.trim().slice(0, 80),
    prompt: cleanPrompt(parsed.prompt).slice(0, PROMPT_MAX_CHARS),
    why: parsed.why.trim().slice(0, 140),
    basedOn: SIGNAL_LABEL[source],
    signal: signal?.headline ?? null,
    goal: parsed.goal && PROMPT_GOALS.includes(parsed.goal) ? parsed.goal : undefined,
  };
}
