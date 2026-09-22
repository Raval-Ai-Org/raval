// citation-probes.server.ts — who actually gets surfaced for the questions
// this brand should own?
//
// The existing probes (probes.server.ts) ask AI answer engines directly. They
// are the truest signal, but each question is a paid model generation, so they
// sit behind FEATURE_FLAG_GEO_AI_PROBES_ENABLED and are off by default. The
// result is that the "AI search" readiness dimension
// (src/lib/geo/dimensions.ts) has had no data to work with in almost every
// deployment.
//
// This is the cheaper half of the same question. Answer engines are retrieval
// systems: they overwhelmingly cite pages that rank for the query. So a web
// search for each probe question tells us, for real, whether this brand shows
// up at all for the things it wants to be known for — and which domains are
// taking that space instead.
//
// It is honest about what it is: the engine is labelled "Web search", not
// ChatGPT. It is a proxy for retrievability, not a transcript of what an
// assistant said, and the UI shows it as such.
import "server-only";
import {
  buildProbeQueries,
  detectMentions,
  extractCitations,
  summarizeProbes,
  type ProbeAnswer,
  type ProbeSummary,
} from "@/lib/geo/probes";
import { webSearch } from "@/server/research/web-search.server";
import { BudgetExceededError } from "@/server/ai/budget";
import type { ProbeContext } from "./scan-runner.server";
import type { ScanRow } from "./store.server";

const ENGINE = "Web search";
const RESULTS_PER_QUERY = 8;

function maxQueries(): number {
  const n = Number(process.env.GEO_CITATION_PROBE_MAX_QUERIES);
  return Number.isFinite(n) && n > 0 ? Math.min(10, Math.floor(n)) : 5;
}

/**
 * Run one search per probe question and read the results for this site.
 *
 * `detectMentions` and `extractCitations` are reused unchanged, so a citation
 * here means exactly what it means for an AI probe: a link to the scanned
 * host. That is what lets both feed the same ProbeSummary.
 */
export async function runGeoCitationProbes(
  scan: ScanRow,
  ctx: ProbeContext,
): Promise<ProbeSummary> {
  const queries = buildProbeQueries({
    brandName: ctx.brandName,
    topics: ctx.topics,
    max: maxQueries(),
  });
  const target = { brandName: ctx.brandName, domain: ctx.site.host };
  const results: ProbeAnswer[] = [];

  for (const query of queries) {
    try {
      const sources = await webSearch(query.text, {
        limit: RESULTS_PER_QUERY,
        // One result per host: the question is which DOMAINS hold this space,
        // and a site with six ranking pages would otherwise look like six.
        perHost: 1,
        route: "geo.citation-probe",
      });
      // The "answer" a retrieval engine would have to work from: the titles
      // and snippets it would be given, in rank order.
      const text = sources
        .map((source, index) => `${index + 1}. ${source.title} (${source.url})\n${source.snippet}`)
        .join("\n\n");
      const citations = extractCitations(
        text,
        sources.map((source) => source.url),
        ctx.site.host,
      );
      const mentions = detectMentions(text, target);
      results.push({
        query,
        engine: ENGINE,
        model: "web-search",
        status: "ok",
        mentioned: mentions.length > 0,
        cited: citations.some((citation) => citation.isTarget),
        mentions: mentions.slice(0, 5),
        citations: citations.slice(0, 15),
        excerpt: text.slice(0, 600),
      });
    } catch (error) {
      results.push({
        query,
        engine: ENGINE,
        model: "web-search",
        status: "error",
        error: error instanceof Error ? error.message.slice(0, 200) : "Search failed",
        mentioned: false,
        cited: false,
        mentions: [],
        citations: [],
        excerpt: "",
      });
      // Out of budget: keep what was collected rather than spending further.
      if (error instanceof BudgetExceededError) break;
    }
  }

  void scan;
  return summarizeProbes(results, queries.length);
}

/**
 * Both halves of the picture when both are available. The AI probes are the
 * stronger signal, so their answers lead; the search pass fills in the
 * questions they did not cover and the competitor domains they did not see.
 */
export async function runCombinedProbes(
  scan: ScanRow,
  ctx: ProbeContext,
  runners: {
    ai?: (scan: ScanRow, ctx: ProbeContext) => Promise<ProbeSummary>;
    search?: (scan: ScanRow, ctx: ProbeContext) => Promise<ProbeSummary>;
  },
): Promise<ProbeSummary> {
  const [ai, search] = await Promise.all([
    runners.ai?.(scan, ctx).catch((error) => {
      console.error("[geo] AI probes failed", error);
      return null;
    }) ?? Promise.resolve(null),
    runners.search?.(scan, ctx).catch((error) => {
      console.error("[geo] citation probes failed", error);
      return null;
    }) ?? Promise.resolve(null),
  ]);

  if (ai && search) {
    const merged = [...ai.results, ...search.results];
    // summarizeProbes recomputes every rate and the competitor tally over the
    // combined set, so the two halves cannot disagree with the summary.
    return summarizeProbes(merged, ai.queries + search.queries);
  }
  return (
    ai ??
    search ?? {
      ranAt: new Date().toISOString(),
      queries: 0,
      answers: 0,
      mentionRate: 0,
      citationRate: 0,
      competitorDomains: [],
      results: [],
    }
  );
}
