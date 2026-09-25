// propose.server.ts — what to test, and the new copy for each treatment page
// (ADR-0024 §5 steps 2–3). Both go through the metered Anthropic gateway.
//
// Grounding: every value is checked with the GEO fix grounding rules. Facts
// (numbers, prices, dates, names, URLs) must already exist in the page's own
// text, Brand DNA or the page's search queries; the known-word threshold is
// EXPERIMENT_GROUNDING_THRESHOLD, lower than for fixes, because new wording
// is the point of a copy test. Page text reaches the model fenced as
// untrusted data.
import "server-only";
import { llmJson } from "@/lib/ai-gateway.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CHANGE_TYPES,
  EXPERIMENT_GROUNDING_THRESHOLD,
  type ChangeType,
  type ExperimentMetric,
} from "@/lib/experiments/constants";
import {
  CHANGE_TYPE_LABELS,
  METRIC_LABELS,
  type HypothesisView,
} from "@/lib/experiments/contracts";
import {
  checkFieldValue,
  FIELD_LIMITS,
  type FaqItem,
  type FieldValue,
} from "@/lib/experiments/datafile";
import { addDays } from "@/lib/analytics/ranges";
import { checkFragments } from "@/server/geo/fixes/grounding";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { lastCompleteDay } from "@/server/analytics/sync/service.server";
import type { GoogleApi } from "@/server/analytics/google/api.server";
import { normalizePath } from "@/lib/experiments/groups";
import { prefixOf } from "./google.server";
import type { FetchedPage } from "./pages.server";
import { beforeValue } from "./pages.server";
import { normHost, type AnalyticsSource } from "./sources.server";

/* ───────────────────────── context ───────────────────────── */

export type BrandContext = { name: string | null; summary: string; corpus: string[] };

function str(value: unknown, max = 600): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** The default Brand Kit Style's own voice, when it sets one (tone only; never facts). */
async function defaultStyleVoice(
  workspaceId: string,
  dna: Record<string, unknown>,
): Promise<string> {
  try {
    const { loadResolvedStyle } = await import("@/server/brand-kit/resolve.server");
    const loaded = await loadResolvedStyle(workspaceId, null, { dna });
    if (!loaded.resolved.styleId || loaded.resolved.fromDna.voice) return "";
    return str(loaded.resolved.writing.voice, 400);
  } catch {
    return "";
  }
}

export async function brandContext(workspaceId: string): Promise<BrandContext> {
  const [dna, ws] = await Promise.all([
    readBrandDna(supabaseAdmin, workspaceId).catch(() => null),
    supabaseAdmin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
  ]);
  const d = (dna?.dna ?? {}) as Record<string, unknown>;
  const fields = [
    ["Brand", str(d.brandName ?? d.name, 120) || str(ws.data?.name, 120)],
    ["What they do", str(d.oneLiner ?? d.tagline ?? d.description)],
    ["Industry", str(d.industry, 200)],
    ["Audience", str(d.audience ?? d.targetAudience)],
    ["Products", str(d.products ?? d.offerings)],
    ["Voice", str(d.voice ?? d.tone ?? d.brandVoice, 400)],
    ["Writing style", await defaultStyleVoice(workspaceId, d)],
  ].filter(([, v]) => v);
  return {
    name: str(d.brandName ?? d.name, 120) || str(ws.data?.name, 120) || null,
    summary: fields.map(([k, v]) => `${k}: ${v}`).join("\n"),
    corpus: [JSON.stringify(d).slice(0, 40_000)],
  };
}

/** Top Search Console queries per page (last 28 complete days). */
export async function queriesByPage(
  api: GoogleApi,
  gsc: AnalyticsSource,
  host: string,
  pattern: string,
  paths: Set<string>,
  perPage = 8,
): Promise<Map<string, string[]>> {
  const end = lastCompleteDay(gsc);
  const prefix = prefixOf(pattern);
  const rows = await api.queryGsc(gsc.external_id, {
    startDate: addDays(end, -27),
    endDate: end,
    dimensions: ["page", "query"],
    rowLimit: 25_000,
    filters:
      prefix && prefix !== "/"
        ? [{ dimension: "page", operator: "contains", expression: prefix }]
        : undefined,
  });
  const byPage = new Map<string, { q: string; clicks: number; impressions: number }[]>();
  for (const r of rows) {
    const [pageUrl, query] = r.keys;
    let path: string | null = null;
    try {
      const u = new URL(pageUrl ?? "");
      if (normHost(u.hostname) === host) path = normalizePath(u.pathname);
    } catch {
      path = null;
    }
    if (!path || !paths.has(path) || !query) continue;
    const list = byPage.get(path) ?? [];
    list.push({ q: query, clicks: r.clicks, impressions: r.impressions });
    byPage.set(path, list);
  }
  const out = new Map<string, string[]>();
  for (const [path, list] of byPage) {
    out.set(
      path,
      list
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, perPage)
        .map((x) => x.q.slice(0, 120)),
    );
  }
  return out;
}

export async function openFindingTitles(workspaceId: string, host: string, paths: string[]) {
  const { data: scan } = await supabaseAdmin
    .from("geo_scans")
    .select("id, origin")
    .eq("workspace_id", workspaceId)
    .eq("host", host)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!scan) return [] as string[];
  const urls = paths.map((p) => new URL(p, scan.origin).toString());
  const { data } = await supabaseAdmin
    .from("geo_findings")
    .select("title, page_url")
    .eq("scan_id", scan.id)
    .in("page_url", urls.slice(0, 50))
    .limit(20);
  return [...new Set((data ?? []).map((f) => f.title))].slice(0, 10);
}

/* ───────────────────────── hypotheses ───────────────────────── */

const HYPOTHESES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hypotheses"],
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["changeType", "title", "hypothesis", "why"],
        properties: {
          changeType: { type: "string", enum: [...CHANGE_TYPES] },
          title: { type: "string" },
          hypothesis: { type: "string" },
          why: { type: "string" },
        },
      },
    },
  },
} as const;

export async function proposeHypotheses(args: {
  brand: BrandContext;
  group: { label: string; pattern: string };
  metric: ExperimentMetric;
  allowed: ChangeType[];
  samples: { page: FetchedPage; queries: string[] }[];
  findings: string[];
}): Promise<HypothesisView[]> {
  const samples = args.samples
    .map(
      ({ page, queries }) =>
        `Page ${page.path}\n  title: ${page.fields?.title ?? "(none)"}\n  meta description: ${page.fields?.meta_description ?? "(none)"}\n  h1: ${page.fields?.h1 ?? "(none)"}\n  top searches: ${queries.join("; ") || "(none)"}`,
    )
    .join("\n\n");
  const result = await llmJson<{ hypotheses?: HypothesisView[] }>({
    route: "experiments.hypotheses",
    system: `You design website A/B tests for a marketing agency. A test changes ONE field on half of a group of similar pages and measures ${METRIC_LABELS[args.metric]} against the other half. Propose up to three distinct, concrete tests that could plausibly move that metric for these pages. Use only these change types: ${args.allowed.map((t) => `${t} (${CHANGE_TYPE_LABELS[t]})`).join(", ")}. Write plainly, no jargon, no hype. "title" is short (≤ 8 words), "hypothesis" is one sentence of the form "Changing X to Y will increase Z because W", "why" is one sentence of evidence from the pages or searches. Never invent statistics.`,
    user: `Brand:\n${args.brand.summary || "(no Brand DNA yet)"}

Group: ${args.group.label} (${args.group.pattern})
Open AI Visibility findings on these pages: ${args.findings.join("; ") || "(none)"}

Sample pages and their top searches:
${wrapUntrusted("site-pages", samples, { maxChars: 14_000, route: "experiments.hypotheses" })}

${UNTRUSTED_DATA_RULE}`,
    maxTokens: 2_500,
    outputSchema: HYPOTHESES_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: 60_000,
    retries: 1,
    fallback: { hypotheses: [] },
  });
  return (result.hypotheses ?? [])
    .filter((h) => args.allowed.includes(h.changeType))
    .slice(0, 3)
    .map((h) => ({
      changeType: h.changeType,
      title: h.title.slice(0, 80),
      hypothesis: h.hypothesis.slice(0, 400),
      why: h.why.slice(0, 400),
    }));
}

/* ───────────────────────── per-page values ───────────────────────── */

const VALUES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pages"],
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "value", "faq"],
        properties: {
          path: { type: "string" },
          value: { type: "string" },
          faq: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["question", "answer"],
              properties: { question: { type: "string" }, answer: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

export type ValueInput = { page: FetchedPage; queries: string[] };

export type GeneratedValue =
  | { path: string; ok: true; value: FieldValue; grounding: { checked: number } }
  | { path: string; ok: false; reason: string };

function fragmentsOf(value: FieldValue): string[] {
  return typeof value === "string"
    ? [value]
    : (value as FaqItem[]).flatMap((f) => [f.question, f.answer]);
}

export function groundValue(
  field: ChangeType,
  value: FieldValue,
  corpus: string[],
): { ok: true; checked: number } | { ok: false; reason: string } {
  const problems = checkFieldValue(field, value);
  if (problems.length) return { ok: false, reason: problems[0] };
  const result = checkFragments(
    fragmentsOf(value).map((text) => ({ path: field, text })),
    corpus,
    EXPERIMENT_GROUNDING_THRESHOLD,
  );
  if (!result.ok)
    return { ok: false, reason: result.ungrounded[0]?.reason ?? "Not grounded in the page." };
  return { ok: true, checked: result.checked };
}

async function generateBatch(
  field: ChangeType,
  hypothesis: string,
  brand: BrandContext,
  batch: ValueInput[],
  feedback: Map<string, string>,
): Promise<Map<string, FieldValue>> {
  const limits = FIELD_LIMITS[field];
  const pages = batch
    .map(({ page, queries }) => {
      const current = beforeValue(page, field);
      return `<page path="${page.path}">
current ${field}: ${current ?? "(none)"}
title: ${page.fields?.title ?? ""}
h1: ${page.fields?.h1 ?? ""}
top searches: ${queries.join("; ")}
page text: ${page.text.slice(0, 2500)}
${feedback.has(page.path) ? `previous attempt was rejected: ${feedback.get(page.path)}` : ""}
</page>`;
    })
    .join("\n");
  const shape =
    field === "faq"
      ? `Return "faq" with ${limits.min}–${limits.max} question/answer pairs answered only from the page text, and "value" as "".`
      : `Return "value" (${limits.min}–${limits.max} characters, plain text, no HTML${field === "intro" ? "" : ", one line"}) and "faq" as [].`;
  const result = await llmJson<{
    pages?: { path: string; value: string; faq: FaqItem[] }[];
  }>({
    route: "experiments.values",
    system: `You write the new ${CHANGE_TYPE_LABELS[field]} for each page in a website test. The test's hypothesis: "${hypothesis}". Apply that idea to every page, written for that page. Use ONLY facts found in that page's own text, its searches or the brand notes — never add numbers, prices, dates, names or claims that aren't there. Keep the brand's voice. ${shape} Answer for every path given, using the exact path.`,
    user: `Brand:\n${brand.summary || "(no Brand DNA)"}\n\n${wrapUntrusted("site-pages", pages, { maxChars: 60_000, route: "experiments.values" })}\n\n${UNTRUSTED_DATA_RULE}`,
    maxTokens: 6_000,
    outputSchema: VALUES_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: 90_000,
    retries: 1,
    fallback: { pages: [] },
  });
  const out = new Map<string, FieldValue>();
  for (const p of result.pages ?? []) {
    out.set(p.path, field === "faq" ? p.faq : p.value.trim());
  }
  return out;
}

/** New values for each page, grounded; one corrective retry per rejected page. */
export async function generateValues(args: {
  field: ChangeType;
  hypothesis: string;
  brand: BrandContext;
  inputs: ValueInput[];
}): Promise<GeneratedValue[]> {
  const results = new Map<string, GeneratedValue>();
  const corpusFor = (input: ValueInput) => [
    input.page.text,
    ...input.queries,
    ...args.brand.corpus,
  ];
  let pending = args.inputs;
  const feedback = new Map<string, string>();
  for (let round = 0; round < 2 && pending.length; round++) {
    const next: ValueInput[] = [];
    for (let i = 0; i < pending.length; i += 10) {
      const batch = pending.slice(i, i + 10);
      const values = await generateBatch(args.field, args.hypothesis, args.brand, batch, feedback);
      for (const input of batch) {
        const value = values.get(input.page.path);
        if (value === undefined) {
          feedback.set(input.page.path, "no value was returned for this path");
          results.set(input.page.path, {
            path: input.page.path,
            ok: false,
            reason: "No value was written for this page.",
          });
          next.push(input);
          continue;
        }
        const before = beforeValue(input.page, args.field);
        if (typeof value === "string" && before && value.trim() === before.trim()) {
          feedback.set(input.page.path, "the value was identical to the current one");
          results.set(input.page.path, {
            path: input.page.path,
            ok: false,
            reason: "The new value was the same as the current one.",
          });
          next.push(input);
          continue;
        }
        const grounded = groundValue(args.field, value, corpusFor(input));
        if (grounded.ok) {
          results.set(input.page.path, {
            path: input.page.path,
            ok: true,
            value,
            grounding: { checked: grounded.checked },
          });
        } else {
          feedback.set(input.page.path, grounded.reason);
          results.set(input.page.path, {
            path: input.page.path,
            ok: false,
            reason: grounded.reason,
          });
          next.push(input);
        }
      }
    }
    pending = next;
  }
  return args.inputs.map((i) => results.get(i.page.path)!);
}
