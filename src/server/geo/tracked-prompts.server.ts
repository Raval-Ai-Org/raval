import "server-only";

// Tracked prompts: the questions a brand wants to be the answer to, asked
// weekly on each answer engine the plan includes. Every check is a paid model
// call through the OpenRouter gateway (metered and budget-checked). Weekly
// checks are included in the plan; "Check now" costs credits (the caller
// wraps it in runMetered).
//
// Honest labels: an engine here is a model answering through the API, which
// is close to, but not the same as, the consumer app a person uses.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProbeEngine } from "@/lib/billing/catalog";
import { buildProbeQueries, detectMentions, extractCitations } from "@/lib/geo/probes";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";

const admin = supabaseAdmin as unknown as SupabaseClient;
const DAY = 86_400_000;

export type TrackedPromptCheck = {
  engine: ProbeEngine;
  mentioned: boolean;
  position: number | null;
  cited: boolean;
  checkedAt: string;
  excerpt: string | null;
  error: string | null;
};

export type TrackedPromptView = {
  id: string;
  text: string;
  paused: boolean;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  latest: TrackedPromptCheck[];
  /** Share of engines that mentioned the brand, per week (oldest first, up to 6). */
  trend: Array<{ week: string; rate: number }>;
};

export type TrackedPromptsOverview = {
  prompts: TrackedPromptView[];
  used: number;
  limit: number;
  engines: ProbeEngine[];
  webSearch: boolean;
};

export const ENGINE_LABEL: Record<ProbeEngine, string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  google_aio: "Google AI Overviews",
};

/** Map the plan's engines onto the configured probe models (task-models.ts). */
export function modelForEngine(engine: ProbeEngine, models: string[]): string | null {
  const prefix =
    engine === "perplexity"
      ? "perplexity/"
      : engine === "chatgpt"
        ? "openai/"
        : engine === "gemini"
          ? "google/"
          : null;
  if (!prefix) return null;
  return models.find((model) => model.startsWith(prefix)) ?? null;
}

export function webSearchEnabled(): boolean {
  return process.env.GEO_PROBE_WEB_SEARCH === "on";
}

/** Weekly by default; the next check lands a week after this one. */
export function nextCheckAfter(checkedAt: Date): Date {
  return new Date(checkedAt.getTime() + 7 * DAY);
}

/** Where the brand appears in the answer: 1 = first company named. Null if absent. */
export function mentionPosition(text: string, brand: string | null, domain: string): number | null {
  const lower = text.toLowerCase();
  const needles = [brand?.toLowerCase().trim(), domain.toLowerCase().replace(/^www\./, "")].filter(
    (value): value is string => Boolean(value && value.length > 1),
  );
  let first = -1;
  for (const needle of needles) {
    const at = lower.indexOf(needle);
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  if (first < 0) return null;
  // Count list items on the lines before the mention's own line: a rough rank.
  const lineStart = text.lastIndexOf("\n", first - 1) + 1;
  const earlier = text.slice(0, lineStart);
  const items = earlier.match(/(^|\n)\s*(\d+[.)]|[-*•])\s+/g)?.length ?? 0;
  return items + 1;
}

/** Pure weekly trend from checks (exported for tests). */
export function weeklyTrend(
  checks: Array<{ checked_at: string; mentioned: boolean }>,
  weeks = 6,
  now = new Date(),
): Array<{ week: string; rate: number }> {
  const buckets = new Map<string, { hit: number; total: number }>();
  for (const check of checks) {
    const at = new Date(check.checked_at);
    const age = Math.floor((now.getTime() - at.getTime()) / (7 * DAY));
    if (age < 0 || age >= weeks) continue;
    const start = new Date(now.getTime() - (age + 1) * 7 * DAY).toISOString().slice(0, 10);
    const bucket = buckets.get(start) ?? { hit: 0, total: 0 };
    bucket.total++;
    if (check.mentioned) bucket.hit++;
    buckets.set(start, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, b]) => ({ week, rate: b.total ? b.hit / b.total : 0 }));
}

async function accountWorkspaceIds(workspaceId: string): Promise<string[]> {
  const { data: space } = await admin
    .from("workspaces")
    .select("billing_account_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!space?.billing_account_id) return [workspaceId];
  const { data } = await admin
    .from("workspaces")
    .select("id")
    .eq("billing_account_id", space.billing_account_id)
    .is("duplicate_of", null);
  return (data ?? []).map((row) => String(row.id));
}

/** Active (not paused) tracked prompts across the account's brands. */
export async function countTrackedPrompts(workspaceIds: string[]): Promise<number> {
  if (!workspaceIds.length) return 0;
  const { count, error } = await admin
    .from("geo_tracked_prompts")
    .select("id", { count: "exact", head: true })
    .in("workspace_id", workspaceIds)
    .is("paused_at", null);
  if (error) return 0;
  return count ?? 0;
}

export async function listTrackedPrompts(args: {
  supabase: SupabaseClient;
  workspaceId: string;
  limit: number;
  engines: ProbeEngine[];
}): Promise<TrackedPromptsOverview> {
  const { data: prompts, error } = await args.supabase
    .from("geo_tracked_prompts")
    .select("id,text,paused_at,last_checked_at,next_check_at")
    .eq("workspace_id", args.workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(503, "Could not load tracked prompts.");
  const ids = (prompts ?? []).map((row) => String(row.id));
  const { data: checks } = ids.length
    ? await args.supabase
        .from("geo_prompt_checks")
        .select("prompt_id,engine,mentioned,position,cited,checked_at,answer_excerpt,error")
        .in("prompt_id", ids)
        .gte("checked_at", new Date(Date.now() - 42 * DAY).toISOString())
        .order("checked_at", { ascending: false })
        .limit(2000)
    : { data: [] };
  const byPrompt = new Map<string, Array<Record<string, unknown>>>();
  for (const check of checks ?? []) {
    const list = byPrompt.get(String(check.prompt_id)) ?? [];
    list.push(check);
    byPrompt.set(String(check.prompt_id), list);
  }
  const used = await countTrackedPrompts(await accountWorkspaceIds(args.workspaceId));
  return {
    used,
    limit: args.limit,
    engines: args.engines,
    webSearch: webSearchEnabled(),
    prompts: (prompts ?? []).map((row) => {
      const list = byPrompt.get(String(row.id)) ?? [];
      const latest = new Map<string, TrackedPromptCheck>();
      for (const check of list) {
        const engine = String(check.engine) as ProbeEngine;
        if (latest.has(engine)) continue;
        latest.set(engine, {
          engine,
          mentioned: Boolean(check.mentioned),
          position: check.position == null ? null : Number(check.position),
          cited: Boolean(check.cited),
          checkedAt: String(check.checked_at),
          excerpt: (check.answer_excerpt as string | null) ?? null,
          error: (check.error as string | null) ?? null,
        });
      }
      return {
        id: String(row.id),
        text: String(row.text),
        paused: Boolean(row.paused_at),
        lastCheckedAt: (row.last_checked_at as string | null) ?? null,
        nextCheckAt: String(row.next_check_at),
        latest: [...latest.values()],
        trend: weeklyTrend(
          list
            .filter((check) => !check.error)
            .map((check) => ({
              checked_at: String(check.checked_at),
              mentioned: Boolean(check.mentioned),
            })),
        ),
      };
    }),
  };
}

/** Add a prompt. The caller checked the role; this checks the pooled plan limit. */
export async function addTrackedPrompt(args: {
  workspaceId: string;
  userId: string;
  text: string;
  limit: number;
  enforce: boolean;
}): Promise<void> {
  const text = args.text.replace(/\s+/g, " ").trim();
  if (text.length < 3) throw new HttpError(400, "Write a question people would ask.");
  if (args.enforce) {
    const used = await countTrackedPrompts(await accountWorkspaceIds(args.workspaceId));
    if (used >= args.limit) {
      const { LimitReachedError } = await import("@/server/billing/errors");
      throw new LimitReachedError({ limit: "trackedPrompts", used, max: args.limit });
    }
  }
  const { error } = await admin.from("geo_tracked_prompts").insert({
    workspace_id: args.workspaceId,
    text: text.slice(0, 300),
    created_by: args.userId,
  });
  if (error?.code === "23505") throw new HttpError(409, "You already track this question.");
  if (error) throw new HttpError(503, "Could not add the prompt.");
}

export async function setTrackedPromptPaused(args: {
  workspaceId: string;
  promptId: string;
  paused: boolean;
  limit: number;
  enforce: boolean;
}): Promise<void> {
  if (!args.paused && args.enforce) {
    const used = await countTrackedPrompts(await accountWorkspaceIds(args.workspaceId));
    if (used >= args.limit) {
      const { LimitReachedError } = await import("@/server/billing/errors");
      throw new LimitReachedError({ limit: "trackedPrompts", used, max: args.limit });
    }
  }
  const { error } = await admin
    .from("geo_tracked_prompts")
    .update({
      paused_at: args.paused ? new Date().toISOString() : null,
      ...(args.paused ? {} : { next_check_at: new Date().toISOString() }),
    })
    .eq("id", args.promptId)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new HttpError(503, "Could not update the prompt.");
}

export async function deleteTrackedPrompt(workspaceId: string, promptId: string): Promise<void> {
  const { error } = await admin
    .from("geo_tracked_prompts")
    .delete()
    .eq("id", promptId)
    .eq("workspace_id", workspaceId);
  if (error) throw new HttpError(503, "Could not delete the prompt.");
}

type BrandTarget = {
  brandName: string | null;
  domain: string;
  competitors: string[];
  topics: string[];
};

async function brandTarget(workspaceId: string): Promise<BrandTarget> {
  const [{ data: space }, { data: dnaRow }, { data: rivals }] = await Promise.all([
    admin.from("workspaces").select("name,domain,website_url").eq("id", workspaceId).maybeSingle(),
    admin.from("workspace_brand_dna").select("dna").eq("workspace_id", workspaceId).maybeSingle(),
    admin
      .from("workspace_competitors")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("status", "tracked")
      .limit(30),
  ]);
  const dna = (dnaRow?.dna ?? {}) as {
    brandName?: string;
    keywords?: string[];
    competitors?: Array<{ name?: string }>;
  };
  const website = String(space?.website_url ?? "");
  let domain = String(space?.domain ?? "");
  if (!domain && website) {
    try {
      domain = new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname;
    } catch {
      domain = "";
    }
  }
  const competitors = [
    ...(rivals ?? []).map((row) => String(row.name)),
    ...(dna.competitors ?? []).map((c) => String(c.name ?? "")),
  ].filter((name) => name.trim().length > 2);
  return {
    brandName: dna.brandName?.trim() || (space?.name as string | null) || null,
    domain: domain.replace(/^www\./, ""),
    competitors: [...new Set(competitors)].slice(0, 30),
    topics: (dna.keywords ?? []).filter((k) => typeof k === "string").slice(0, 8),
  };
}

/** Suggestions from Brand DNA that the brand does not track yet. */
export async function suggestTrackedPrompts(workspaceId: string): Promise<string[]> {
  const target = await brandTarget(workspaceId);
  const { data } = await admin
    .from("geo_tracked_prompts")
    .select("text")
    .eq("workspace_id", workspaceId);
  const have = new Set((data ?? []).map((row) => String(row.text).toLowerCase()));
  return buildProbeQueries({ brandName: target.brandName, topics: target.topics, max: 10 })
    .map((query) => query.text)
    .filter((text) => !have.has(text.toLowerCase()))
    .slice(0, 6);
}

const SYSTEM =
  "Answer the question the way you would for someone searching the web. Be concise and specific. " +
  "Name the companies, products or websites you would recommend, and include source URLs where you can.";

function providerCitations(json: unknown): string[] {
  const j = json as {
    citations?: unknown;
    choices?: { message?: { annotations?: { url_citation?: { url?: string } }[] } }[];
  };
  const out: string[] = [];
  if (Array.isArray(j?.citations))
    for (const c of j.citations) if (typeof c === "string") out.push(c);
  for (const a of j?.choices?.[0]?.message?.annotations ?? []) {
    if (typeof a?.url_citation?.url === "string") out.push(a.url_citation.url);
  }
  return out;
}

/** Ask every plan engine one tracked prompt and store the answers. */
export async function checkTrackedPrompt(args: {
  promptId: string;
  workspaceId: string;
  text: string;
  engines: ProbeEngine[];
}): Promise<{ checked: number; failed: number }> {
  const { chatCompletion } = await import("@/lib/ai-gateway.server");
  const { geoProbeModels } = await import("@/server/ai/task-models");
  const { BudgetExceededError } = await import("@/server/ai/budget");
  const target = await brandTarget(args.workspaceId);
  const models = geoProbeModels();
  const web = webSearchEnabled();
  let checked = 0;
  let failed = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const engine of args.engines) {
    const base = modelForEngine(engine, models);
    if (!base) continue;
    // Perplexity always searches; the others do when web search is switched on.
    const model = web && !base.startsWith("perplexity/") ? `${base}:online` : base;
    try {
      const json = await chatCompletion({
        plan: { models: [model] },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: args.text },
        ],
        max_tokens: 700,
        temperature: 0.2,
        route: "geo.probe",
        task: "generate",
      });
      const text = String(json?.choices?.[0]?.message?.content ?? "");
      const mentions = target.domain ? detectMentions(text, target) : [];
      const citations = target.domain
        ? extractCitations(text, providerCitations(json), target.domain)
        : [];
      const lower = text.toLowerCase();
      rows.push({
        prompt_id: args.promptId,
        workspace_id: args.workspaceId,
        engine,
        model: String(json?._model ?? model),
        mentioned: mentions.length > 0,
        position: mentions.length ? mentionPosition(text, target.brandName, target.domain) : null,
        cited: citations.some((c) => c.isTarget),
        cited_urls: citations.slice(0, 10).map((c) => c.url),
        competitors_mentioned: target.competitors.filter((name) =>
          lower.includes(name.toLowerCase()),
        ),
        answer_excerpt: text.slice(0, 600),
        web_search: web || base.startsWith("perplexity/"),
      });
      checked++;
    } catch (error) {
      failed++;
      rows.push({
        prompt_id: args.promptId,
        workspace_id: args.workspaceId,
        engine,
        model,
        error: error instanceof Error ? error.message.slice(0, 200) : "Check failed",
      });
      if (error instanceof BudgetExceededError) break;
    }
  }
  if (rows.length) await admin.from("geo_prompt_checks").insert(rows);
  const now = new Date();
  await admin
    .from("geo_tracked_prompts")
    .update({
      last_checked_at: now.toISOString(),
      next_check_at: nextCheckAfter(now).toISOString(),
      lease_until: null,
    })
    .eq("id", args.promptId);
  return { checked, failed };
}

/**
 * Geo-scans cron: check prompts that are due. Skips frozen brands, paused or
 * past-grace accounts (engines come from each account's own plan), and Free
 * accounts nobody has used for 30 days.
 */
export async function runDueTrackedPrompts(args: {
  budgetMs: number;
  max: number;
}): Promise<{ checked: number; skipped: number }> {
  const started = Date.now();
  const { data, error } = await admin.rpc("claim_tracked_prompts", {
    p_limit: args.max,
    p_lease_seconds: 300,
  });
  if (error) return { checked: 0, skipped: 0 };
  const { getEntitlements } = await import("@/server/billing/entitlements.server");
  const { accountForWorkspace } = await import("@/server/billing/accounts.server");
  let checked = 0;
  let skipped = 0;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const workspaceId = String(row.workspace_id);
    const postpone = async (days: number) =>
      admin
        .from("geo_tracked_prompts")
        .update({
          next_check_at: new Date(Date.now() + days * DAY).toISOString(),
          lease_until: null,
        })
        .eq("id", row.id);
    if (Date.now() - started > args.budgetMs) {
      await admin.from("geo_tracked_prompts").update({ lease_until: null }).eq("id", row.id);
      break;
    }
    try {
      const { account } = await accountForWorkspace(workspaceId);
      const entitlements = await getEntitlements({
        workspaceId,
        userId: account.owner_user_id,
        role: "owner",
        skipCapacityReconcile: true,
      });
      let inactiveFree = false;
      if (entitlements.entitledPlan === "free") {
        const { data: owner } = await admin.auth.admin.getUserById(account.owner_user_id);
        const lastSeen = owner?.user?.last_sign_in_at ?? account.created_at;
        inactiveFree = Date.now() - new Date(lastSeen).getTime() > 30 * DAY;
      }
      if (entitlements.frozen || entitlements.status === "paused" || inactiveFree) {
        skipped++;
        await postpone(7);
        continue;
      }
      await checkTrackedPrompt({
        promptId: String(row.id),
        workspaceId,
        text: String(row.text),
        engines: entitlements.limits.engines.filter((engine) => engine !== "google_aio"),
      });
      checked++;
    } catch (cause) {
      console.error("[tracked-prompts] check failed", row.id, cause);
      await postpone(1);
    }
  }
  return { checked, skipped };
}
