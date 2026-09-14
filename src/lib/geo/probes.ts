// probes.ts — AI answer-engine visibility: which questions to ask, and how to
// read the answers. Ports of the GEO module's query intelligence templates
// and its mention / citation detection. Pure; the paid model calls live in
// src/server/geo/probes.server.ts behind FEATURE_FLAG_GEO_AI_PROBES_ENABLED.

export type ProbeIntent = "informational" | "commercial" | "comparison" | "problem_solving";

export type ProbeQuery = { text: string; intent: ProbeIntent; source: "brand" | "topic" };

export type ProbeMention = { text: string; kind: "brand" | "domain"; snippet: string };
export type ProbeCitation = { url: string; domain: string; isTarget: boolean; position: number };

export type ProbeAnswer = {
  query: ProbeQuery;
  engine: string;
  model: string;
  status: "ok" | "error";
  error?: string;
  mentioned: boolean;
  cited: boolean;
  mentions: ProbeMention[];
  citations: ProbeCitation[];
  /** First 600 characters, for evidence. */
  excerpt: string;
};

export type ProbeSummary = {
  ranAt: string;
  queries: number;
  answers: number;
  mentionRate: number;
  citationRate: number;
  competitorDomains: { domain: string; count: number }[];
  results: ProbeAnswer[];
};

const GENERIC_BRANDS = new Set([
  "target",
  "apple",
  "box",
  "next",
  "meta",
  "amazon",
  "oracle",
  "square",
  "stripe",
  "block",
  "ring",
  "nest",
  "wave",
  "spark",
  "zoom",
  "slack",
  "notion",
  "linear",
  "click",
  "base",
]);

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|ref|source|mc_cid|mc_eid)$/i;

export function classifyIntent(text: string): ProbeIntent {
  const t = ` ${text.toLowerCase()} `;
  if (
    / vs | versus |difference between|compared to|alternatives to|better than|pros and cons/.test(t)
  ) {
    return "comparison";
  }
  if (
    /how to fix|how do i fix|how to improve|troubleshoot|not working|why is my|how to avoid/.test(t)
  ) {
    return "problem_solving";
  }
  if (
    /\bbest\b|\btop\b|pricing|price|cost|review|worth it|\bbuy\b|recommended|which (tool|platform|software|provider)/.test(
      t,
    )
  ) {
    return "commercial";
  }
  return "informational";
}

/** Bounded, deterministic query set (at most `max`) from the brand and the site's topics. */
export function buildProbeQueries(input: {
  brandName: string | null;
  topics: string[];
  max?: number;
}): ProbeQuery[] {
  const max = input.max ?? 6;
  const out: ProbeQuery[] = [];
  const push = (text: string, source: ProbeQuery["source"]) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || out.some((q) => q.text.toLowerCase() === clean.toLowerCase())) return;
    out.push({ text: clean, intent: classifyIntent(clean), source });
  };
  const brand = input.brandName?.trim();
  const topics = input.topics.map((t) => t.trim()).filter((t) => t.length > 2);

  if (brand) {
    push(`What is ${brand}?`, "brand");
    push(`${brand} vs top alternatives`, "brand");
  }
  for (const topic of topics) {
    push(`What are the best ${topic} solutions?`, "topic");
    push(`How does ${topic} work?`, "topic");
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export function domainOf(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function normalizeCitationUrl(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (TRACKING.test(key)) u.searchParams.delete(key);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const s = u.toString();
    return s.endsWith("/") && u.pathname !== "/" ? s.slice(0, -1) : s;
  } catch {
    return url.trim();
  }
}

function snippet(text: string, start: number, end: number, window = 60): string {
  const s = Math.max(0, start - window);
  const e = Math.min(text.length, end + window);
  return `${s > 0 ? "…" : ""}${text.slice(s, e).trim()}${e < text.length ? "…" : ""}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Brand and domain mentions. Generic-word brands ("Notion", "Linear") are
 * matched case-sensitively so ordinary prose doesn't count as a mention.
 */
export function detectMentions(
  text: string,
  target: { brandName: string | null; domain: string },
): ProbeMention[] {
  const mentions: ProbeMention[] = [];
  const claimed: [number, number][] = [];
  const overlaps = (s: number, e: number) =>
    claimed.some(([cs, ce]) => Math.max(s, cs) < Math.min(e, ce));

  const brand = target.brandName?.trim();
  if (brand && brand.length >= 2) {
    const flags = GENERIC_BRANDS.has(brand.toLowerCase()) ? "g" : "gi";
    for (const m of text.matchAll(new RegExp(`\\b${escapeRe(brand)}\\b`, flags))) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (overlaps(s, e)) continue;
      claimed.push([s, e]);
      mentions.push({ text: m[0], kind: "brand", snippet: snippet(text, s, e) });
      if (mentions.length >= 10) break;
    }
  }
  const domain = target.domain.trim().toLowerCase();
  if (domain.length >= 4) {
    for (const m of text.matchAll(
      new RegExp(`(?:\\b|https?://|www\\.)${escapeRe(domain)}\\b`, "gi"),
    )) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (overlaps(s, e)) continue;
      claimed.push([s, e]);
      mentions.push({ text: m[0], kind: "domain", snippet: snippet(text, s, e) });
      if (mentions.length >= 15) break;
    }
  }
  return mentions;
}

/** URLs cited in the answer text and in provider citation metadata, in order, deduplicated. */
export function extractCitations(
  text: string,
  providerCitations: string[],
  targetDomain: string,
): ProbeCitation[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g)) found.push(m[1]);
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s)"'<>\]]+/gi))
    found.push(m[0].replace(/[.,;:!?)\]]+$/, ""));
  for (const c of providerCitations) if (/^https?:\/\//i.test(c)) found.push(c);

  const seen = new Set<string>();
  const out: ProbeCitation[] = [];
  const target = targetDomain.toLowerCase();
  for (const raw of found) {
    const norm = normalizeCitationUrl(raw);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const domain = domainOf(norm);
    if (!domain) continue;
    out.push({
      url: norm,
      domain,
      isTarget: !!target && (domain === target || domain.endsWith(`.${target}`)),
      position: out.length + 1,
    });
    if (out.length >= 30) break;
  }
  return out;
}

export function summarizeProbes(results: ProbeAnswer[], queries: number): ProbeSummary {
  const ok = results.filter((r) => r.status === "ok");
  const competitors = new Map<string, number>();
  for (const r of ok) {
    for (const c of r.citations)
      if (!c.isTarget) competitors.set(c.domain, (competitors.get(c.domain) ?? 0) + 1);
  }
  const rate = (n: number) => (ok.length ? Math.round((n / ok.length) * 100) / 100 : 0);
  return {
    ranAt: new Date().toISOString(),
    queries,
    answers: ok.length,
    mentionRate: rate(ok.filter((r) => r.mentioned).length),
    citationRate: rate(ok.filter((r) => r.cited).length),
    competitorDomains: [...competitors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count })),
    results,
  };
}
