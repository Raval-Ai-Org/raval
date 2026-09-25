// ideas.server.ts — the model pass over Studio's idea signals.
//
// Signals come from the workspace (moments, trends, competitor moves, gaps,
// brand pillars). The model turns the strongest ones into specific,
// brand-grounded ideas; a deterministic fallback keeps the panel useful when
// the model is unavailable or the plan is degraded.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runStructuredPrompt } from "@/lib/ai";
import { STUDIO_FORMATS, STUDIO_TYPE_ORDER, type StudioType } from "@/lib/studio/formats";
import {
  collectSignals,
  dedupeIdeas,
  fallbackIdeas,
  sanitizeIdea,
  type StudioIdea,
} from "@/lib/studio/ideas";
import { sections } from "@/lib/studio/prompts";
import { cache } from "@/server/cache/store";
import { loadStudioContext } from "./context.server";

// Shared cache (Redis when configured): every app instance reuses one model
// pass instead of each process paying for its own.
const CACHE_TTL_SECONDS = 30 * 60;
type CachedIdeas = { ideas: StudioIdea[]; generated: "model" | "fallback" };

const IdeasSchema = z.object({
  ideas: z
    .array(
      z.object({
        type: z.string(),
        title: z.coerce.string(),
        why: z.coerce.string().default(""),
        brief: z.coerce.string(),
        platforms: z.array(z.string()).default([]),
        source: z.string().default("pillar"),
        goal: z
          .enum(["awareness", "engagement", "leads", "launch", "education", "offer"])
          .optional()
          .catch(undefined),
      }),
    )
    .min(1)
    .max(10),
});

function digest(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(h, 31) + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function generateStudioIdeas(args: {
  client: unknown;
  workspaceId: string;
  brand: Record<string, unknown> | null | undefined;
  type?: StudioType;
  dismissed?: string[];
  refresh?: boolean;
  limit?: number;
}): Promise<{ ideas: StudioIdea[]; generated: "model" | "fallback"; cached: boolean }> {
  const limit = args.limit ?? 5;
  const ctx = await loadStudioContext(args.client as SupabaseClient, args.workspaceId, args.brand);
  const signals = collectSignals(ctx, ctx.brand);
  // An empty workspace only produces cadence/gap boilerplate. Wait for a real
  // brand, customer, market, or competitor signal before calling it personal.
  if (!signals.some((signal) => !["gap", "momentum"].includes(signal.source))) {
    return { ideas: [], generated: "fallback", cached: false };
  }
  const rankedSignals = [
    ...signals.filter((signal) => !["gap", "momentum"].includes(signal.source)),
    ...signals.filter((signal) => ["gap", "momentum"].includes(signal.source)),
  ];
  const avoid = [...ctx.recent.map((r) => r.title), ...(args.dismissed ?? [])];

  const key = [
    args.workspaceId,
    args.type ?? "all",
    digest(signals.map((s) => s.headline).join("|")),
    digest(ctx.brandText),
    digest(signals.map((s) => `${s.source}:${s.detail}`).join("|")),
    digest(
      ctx.recent
        .slice(0, 10)
        .map((r) => r.title)
        .join("|"),
    ),
  ].join(":");
  const cacheKey = `studio:ideas:${key}`;
  const hit = args.refresh ? null : await cache.get<CachedIdeas>(cacheKey);
  if (hit) {
    return {
      ideas: dedupeIdeas(hit.ideas, args.dismissed ?? []).slice(0, limit),
      generated: hit.generated,
      cached: true,
    };
  }

  const only = args.type;
  const typeLines = (only ? [only] : STUDIO_TYPE_ORDER)
    .map((t) => {
      const f = STUDIO_FORMATS[t];
      return `- ${t}: ${f.description}${f.platforms.length ? ` Platforms: ${f.platforms.join(", ")}.` : ""}`;
    })
    .join("\n");

  const system = [
    "You are Mellox, a senior marketing strategist who knows this business well.",
    "Propose what the team should create next. Each idea must be anchored on ONE of the listed signals and say so in `why` (≤ 110 characters, concrete — cite the signal, not a platitude).",
    "Titles are specific working titles a marketer would actually use (≤ 70 characters). Never start with 'Create', 'Write', 'Post about', or 'A post about'.",
    "`brief` is 2–4 sentences: the idea, the angle, what makes it specific to this brand, and the intended reaction. It is used verbatim as the creation brief.",
    "Diversify: different signals, different angles" +
      (only ? "." : ", and a mix of formats that genuinely suit each idea."),
    "Do not repeat or lightly reword anything in the recent-content or dismissed lists.",
    "Never invent statistics, customers, or events that aren't in the context.",
    "Use the brand's actual audience, positioning, voice and offer. Competitor angles must be fair and traceable to a supplied competitor fact. Do not suggest a holiday or platform unless the context supports its relevance.",
    "Use brand, customer, market, or competitor facts as the creative topic. Activity gaps and momentum may explain timing, but cannot be the only basis for an idea.",
    "Return STRICT JSON only.",
    `Schema: {"ideas":[{"type": ${only ? `"${only}"` : "one of the format ids"}, "title": string, "why": string, "brief": string, "platforms": string[], "source": "season"|"trend"|"competitor"|"gap"|"pillar"|"momentum", "goal": "awareness"|"engagement"|"leads"|"launch"|"education"|"offer"}]}`,
  ].join("\n");

  const user = sections([
    { label: "Brand", body: ctx.brandText || `Brand: ${ctx.brandName}` },
    {
      label: "Business",
      body: [
        ctx.industry && `Industry: ${ctx.industry}`,
        ctx.audience && `Audience: ${ctx.audience}`,
        `Today: ${ctx.today}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      label: "Signals (strongest first)",
      body: rankedSignals
        .slice(0, 10)
        .map((s) => `- [${s.source}] ${s.headline} — ${s.detail}`)
        .join("\n"),
    },
    { label: "Formats", body: typeLines },
    {
      label: "Recent content — do not repeat",
      body: ctx.recent
        .slice(0, 15)
        .map((r) => `- ${r.title}`)
        .join("\n"),
    },
    {
      label: "Dismissed ideas — avoid",
      body: (args.dismissed ?? [])
        .slice(0, 15)
        .map((t) => `- ${t}`)
        .join("\n"),
    },
    { label: "Output", body: `Return ${limit + 2} ideas.` },
  ]);

  let ideas: StudioIdea[];
  let generated: "model" | "fallback" = "model";
  try {
    const parsed = await runStructuredPrompt({
      route: "studio.ideas",
      system,
      user,
      schema: IdeasSchema,
      maxTokens: 2200,
      temperature: 0.9,
      regenerate: args.refresh,
    });
    ideas = parsed.ideas
      .map((raw) => sanitizeIdea(raw as never, only))
      .filter((idea): idea is StudioIdea => !!idea);
    if (ideas.length < 2) throw new Error("Too few usable ideas");
  } catch (error) {
    console.warn(
      "[studio-ideas] model pass failed, using fallback",
      error instanceof Error ? error.message : error,
    );
    ideas = fallbackIdeas(rankedSignals, ctx, { only, limit: limit + 2 });
    generated = "fallback";
  }

  const deduped = dedupeIdeas(ideas, avoid);
  await cache.set(cacheKey, { ideas: deduped, generated } satisfies CachedIdeas, CACHE_TTL_SECONDS);
  return { ideas: deduped.slice(0, limit), generated, cached: false };
}
