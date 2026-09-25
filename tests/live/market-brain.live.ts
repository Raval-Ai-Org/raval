// market-brain.live.ts — Market Brain's Tavily-based replacement for
// DataForSEO/Google Trends (ADR-0023), against the real Tavily API, the real
// Supabase project (its migration, RLS-free service paths) and one real
// Claude call. Creates one temporary user and workspace and deletes both (and
// everything that cascades from them — the collection row and its cached
// analysis) at the end.
//
//   npx vitest run --config vitest.live.config.ts tests/live/market-brain.live.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const configured =
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.TAVILY_API_KEY;

let admin: SupabaseClient;
let userId: string;
let workspaceId: string;

(configured ? describe : describe.skip)("Market Brain (live Tavily + Supabase)", () => {
  beforeAll(async () => {
    const mod = await import("@/integrations/supabase/client.server");
    admin = mod.supabaseAdmin as unknown as SupabaseClient;

    const email = `market-brain-${randomUUID().slice(0, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `${randomUUID()}Aa1!`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;

    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const workspace = await createOrGetWorkspace({
      userId,
      name: "Market Brain Live Test",
      websiteUrl: `https://market-brain-live-${randomUUID().slice(0, 8)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    workspaceId = workspace.id;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, 60_000);

  it("collects real web sources for a real keyword and stores them", async () => {
    const { requestMarketSignalsCollection } =
      await import("@/lib/market-signals-collection.server");
    const result = await requestMarketSignalsCollection(
      { keywords: ["artificial intelligence"], location: "United States" },
      workspaceId,
      "live-test",
    );

    expect(["completed", "no_data"]).toContain(result.state);
    if (result.state === "completed") {
      expect(result.data?.sources.length).toBeGreaterThan(0);
      for (const source of result.data!.sources) {
        expect(source.url.startsWith("http")).toBe(true);
        expect(source.title.length).toBeGreaterThan(0);
        expect(source.domain.length).toBeGreaterThan(0);
      }
    }

    const { data: row, error } = await admin
      .from("market_trend_collections")
      .select("status, provider, normalized_result")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(row?.status).toBe("completed");
    expect(row?.provider).toBe("tavily");
  }, 60_000);

  it("reuses the cached collection instead of searching again", async () => {
    const { requestMarketSignalsCollection } =
      await import("@/lib/market-signals-collection.server");
    const result = await requestMarketSignalsCollection(
      { keywords: ["artificial intelligence"], location: "United States" },
      workspaceId,
      "live-test",
    );
    expect(["cached", "no_data"]).toContain(result.state);
  }, 30_000);

  it("turns the collected evidence into grounded Claude intelligence", async () => {
    const { data: row } = await admin
      .from("market_trend_collections")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (row?.status !== "completed") return; // no_data path: nothing to analyze.

    const { analyzeMarketCollection } = await import("@/lib/market-intelligence.server");
    const result = await analyzeMarketCollection({
      collectionId: row.id as string,
      workspaceId,
      analysisType: "market_strategy",
    });

    expect(["completed", "cached"]).toContain(result.state);
    expect(result.data?.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.data?.trendSignals)).toBe(true);
  }, 120_000);
});
