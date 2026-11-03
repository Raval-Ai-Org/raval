// Live check of Community Intelligence against the real Supabase project and
// the real open community APIs (reads .env):
//
//   queries: built from a real workspace's stored Brand DNA, products,
//     audience and tracked competitors — never by a model
//   Hacker News (Algolia) and Stack Exchange: real answers through safeFetch,
//     every thread has a real link that threadIdentity accepts
//   the tables and claim_community_jobs: a job row is created on a workspace
//     that has none, claimed with a lease, and deleted again; a thread is
//     stored once even when written twice (unique fingerprint), then deleted
//
// Free by default. COMMUNITY_LIVE_SEARCH=yes also runs the Reddit/Quora
// queries through the one web-search path (a few Tavily searches).
// COMMUNITY_LIVE_AI=yes also classifies the threads (one economy call) and
// drafts one reply (one workhorse call) and checks the reply rules held.
// Nothing is ever posted anywhere.
//   npx vitest run --config vitest.live.config.ts tests/live/community.live.ts
import { afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const REAL_SEARCH = process.env.COMMUNITY_LIVE_SEARCH === "yes";
const REAL_AI = process.env.COMMUNITY_LIVE_AI === "yes";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

const cleanup: Array<() => Promise<unknown>> = [];
afterAll(async () => {
  for (const undo of cleanup.reverse()) await undo().catch(() => undefined);
});

/** The workspace with the most Brand DNA filled in. */
async function richestWorkspace(db: SupabaseClient): Promise<string> {
  const { data } = await db.from("workspace_brand_dna").select("workspace_id, dna").limit(200);
  const rows = (data ?? []) as { workspace_id: string; dna: Record<string, unknown> }[];
  rows.sort((a, b) => JSON.stringify(b.dna ?? {}).length - JSON.stringify(a.dna ?? {}).length);
  if (!rows[0]) throw new Error("No workspace with Brand DNA");
  return rows[0].workspace_id;
}

async function tablesExist(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("community_jobs").select("id").limit(1);
  return !error;
}

describeLive("community intelligence (live)", () => {
  it("builds queries from stored brand facts and finds real threads", async () => {
    const db = await admin();
    const workspaceId = await richestWorkspace(db);
    const { buildCommunityQueries } = await import("@/lib/community/queries");
    const { threadIdentity, mergeThreads } = await import("@/lib/community/threads");
    const { loadCommunityBrand } = await import("@/server/community/context.server");
    const { runCommunityQueries } = await import("@/server/community/discover.server");

    // Before the migration is applied the watches read just comes back empty.
    const brand = await loadCommunityBrand(workspaceId);
    const queries = buildCommunityQueries(brand);
    console.info(
      `[community.live] ${queries.length} queries for ${brand.brandName || workspaceId}`,
    );
    expect(queries.length).toBeGreaterThan(0);

    const runnable = REAL_SEARCH
      ? queries
      : queries.filter((q) => q.source === "hackernews" || q.source === "stackexchange");
    const { threads, searched } = await runCommunityQueries(runnable, brand);
    console.info(`[community.live] ${searched} lookups → ${threads.length} threads`);
    for (const t of threads) {
      expect(threadIdentity(t.url)?.fingerprint).toBe(t.fingerprint);
      expect(t.url.startsWith("https://")).toBe(true);
    }
    const merged = mergeThreads(threads);
    expect(new Set(merged.map((t) => t.fingerprint)).size).toBe(merged.length);

    if (REAL_AI && merged.length) {
      const { classifyThreads } = await import("@/server/community/classify.server");
      const { runWithScope } = await import("@/server/request-context");
      const classified = await runWithScope({ workspaceId, route: "community.classify" }, () =>
        classifyThreads({
          threads: merged.slice(0, 10),
          brandLine: brand.facts,
          competitors: brand.competitors,
        }),
      );
      const urls = new Set(merged.map((t) => t.url));
      for (const t of classified) expect(urls.has(t.url)).toBe(true);
    }
  }, 120_000);

  it("stores a thread once and leases one refresh per workspace", async () => {
    const db = await admin();
    if (!(await tablesExist(db))) {
      console.warn(
        "[community.live] tables missing — apply 20261103110000_community_intelligence.sql",
      );
      return;
    }
    // A workspace with no community job yet, so nothing real is touched.
    const { data: jobs } = await db.from("community_jobs").select("workspace_id");
    const taken = new Set(((jobs ?? []) as { workspace_id: string }[]).map((j) => j.workspace_id));
    const { data: spaces } = await db.from("workspaces").select("id").limit(50);
    const workspaceId = ((spaces ?? []) as { id: string }[]).find((w) => !taken.has(w.id))?.id;
    if (!workspaceId) return;

    const fingerprint = `hn:live-${Date.now()}`;
    const row = {
      workspace_id: workspaceId,
      url: "https://news.ycombinator.com/item?id=1",
      source: "hackernews",
      community: "Hacker News",
      title: "Live check thread",
      matched_on: "category",
      fingerprint,
    };
    cleanup.push(() =>
      db
        .from("community_threads")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("fingerprint", fingerprint),
    );
    for (let i = 0; i < 2; i++) {
      const { error } = await db
        .from("community_threads")
        .upsert(row, { onConflict: "workspace_id,fingerprint", ignoreDuplicates: true });
      expect(error).toBeNull();
    }
    const { count } = await db
      .from("community_threads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("fingerprint", fingerprint);
    expect(count).toBe(1);

    cleanup.push(() => db.from("community_jobs").delete().eq("workspace_id", workspaceId));
    const { error: jobError } = await db
      .from("community_jobs")
      // Far in the future: the deployed cron must not pick it up meanwhile.
      .insert({ workspace_id: workspaceId, status: "paused", next_run_at: "2100-01-01T00:00:00Z" });
    expect(jobError).toBeNull();
    // Paused jobs are never claimed.
    const none = await db.rpc("claim_community_jobs", {
      p_worker: "live-check",
      p_max: 1,
      p_lease_seconds: 30,
      p_workspace_id: workspaceId,
    });
    expect(none.error).toBeNull();
    expect(none.data ?? []).toHaveLength(0);
    await db.from("community_jobs").update({ status: "idle" }).eq("workspace_id", workspaceId);
    const claimed = await db.rpc("claim_community_jobs", {
      p_worker: "live-check",
      p_max: 1,
      p_lease_seconds: 30,
      p_workspace_id: workspaceId,
    });
    expect(claimed.error).toBeNull();
    expect((claimed.data as { locked_by: string }[])[0]?.locked_by).toBe("live-check");
    // Leased: a second claim gets nothing.
    const again = await db.rpc("claim_community_jobs", {
      p_worker: "other",
      p_max: 1,
      p_lease_seconds: 30,
      p_workspace_id: workspaceId,
    });
    expect(again.data ?? []).toHaveLength(0);
  }, 60_000);

  it.runIf(REAL_AI)(
    "drafts a reply that follows the rules",
    async () => {
      const db = await admin();
      const workspaceId = await richestWorkspace(db);
      const { draftCommunityReply } = await import("@/server/community/reply.server");
      const { runWithScope } = await import("@/server/request-context");
      const { loadCommunityBrand } = await import("@/server/community/context.server");
      const brand = await loadCommunityBrand(workspaceId);
      const reply = await runWithScope({ workspaceId, route: "community.reply" }, () =>
        draftCommunityReply({
          workspaceId,
          thread: {
            id: "00000000-0000-4000-8000-000000000001",
            url: "https://news.ycombinator.com/item?id=1",
            source: "reddit",
            community: "r/smallbusiness",
            title: `What should I look for in ${brand.category || "a supplier"}?`,
            snippet: "I keep getting burned by tools that promise a lot. Any advice?",
            summary: "",
            matchedOn: "problem",
            matchedTerm: brand.category,
            competitorName: null,
            relevance: 80,
            postedAt: null,
            foundAt: new Date().toISOString(),
            status: "new",
            reply: null,
          },
        }),
      );
      console.info(`[community.live] reply (${reply.text.length} chars):\n${reply.text}`);
      expect(reply.text.length).toBeGreaterThan(40);
      expect(reply.text.length).toBeLessThanOrEqual(1_400);
      if (brand.brandName && reply.text.toLowerCase().includes(brand.brandName.toLowerCase())) {
        expect(reply.disclosed).toBe(true);
      }
    },
    120_000,
  );
});
