// Live check of the structured Claude routes after the cost work: Brand DNA
// synthesis, a coach-style briefing and a real market-intelligence analysis.
// Each must finish in ONE metered call without truncation. Opt-in (real Claude
// spend, roughly $0.05-0.10):
//   npx vitest run --config vitest.live.config.ts tests/live/claude-json.live.ts
// Usage is still recorded to ai_usage_events like production traffic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

describeLive("Claude structured output (live)", () => {
  const rows: UsageRecord[] = [];
  let restoreSink: (() => void) | null = null;
  const callsFor = (route: string) => rows.filter((row) => row.route === route);

  beforeAll(async () => {
    const { setUsageSink } = await import("@/server/ai/metering");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Capture every metered call in-process — the default sink is fire-and-forget
    // and a test worker can exit before it lands — and still record it.
    restoreSink = setUsageSink(async (row) => {
      rows.push(row);
      await supabaseAdmin.rpc("record_ai_usage", { p_event: row as never });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    restoreSink?.();
  });

  it("synthesises Brand DNA in one untruncated call", async () => {
    const { runBrandExtraction } = await import("@/lib/brand-extract.server");
    const events: { type: string }[] = [];
    await runBrandExtraction(
      new URL(process.env.BRAND_EXTRACT_LIVE_URL || "https://stripe.com"),
      (e) => events.push(e),
    );

    const calls = callsFor("brand-extract");
    console.info("[live] brand-extract calls", JSON.stringify(calls));
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "result")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ truncated: false, status: "ok" });
  }, 240_000);

  it("returns a complete coach briefing from one schema-constrained call", async () => {
    const { claudeJsonPrompt, selectClaudeModel } = await import("@/lib/anthropic-gateway.server");
    const { COACH_OUTPUT_SCHEMA } = await import("@/lib/ai/output-schemas");
    const { coachSystem } = await import("@/lib/ai/prompts");

    const briefing = await claudeJsonPrompt<Record<string, unknown>>({
      route: "coach.briefing",
      system: coachSystem("Wednesday"),
      user: [
        "Today: 2026-09-16 (Wednesday)",
        "Brand seed: Stripe",
        `## Workspace signals\n${JSON.stringify({
          publishedLast7d: 2,
          scheduledNext7d: 0,
          pendingDrafts: 5,
          latestGeoScore: 61,
          previousGeoScore: 55,
          recentInsights: ["Developers choose us for documentation quality"],
        })}`,
        "## Site content (scraped just now)\nStripe is a financial infrastructure platform for businesses. Payments, billing, and more for companies of every size.",
        "Where an item has no suitable action or source, use empty strings for them.",
      ].join("\n\n"),
      fallback: {},
      model: selectClaudeModel("marketing-coach"),
      effort: "medium",
      maxTokens: 6000,
      outputSchema: COACH_OUTPUT_SCHEMA,
      timeoutMs: 90_000,
      retries: 1,
    });

    const calls = callsFor("coach.briefing");
    console.info("[live] coach calls", JSON.stringify(calls));
    expect(Object.keys(briefing).length).toBeGreaterThan(0);
    expect(typeof briefing.headline).toBe("string");
    expect(Array.isArray(briefing.wins)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ truncated: false, status: "ok" });
  }, 120_000);

  it("analyses a real trend collection at most once, then serves it from cache", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runWithScope } = await import("@/server/request-context");
    const { analyzeMarketCollection } = await import("@/lib/market-intelligence.server");

    const { data: collection } = await supabaseAdmin
      .from("market_trend_collections")
      .select("id, workspace_id")
      .eq("status", "completed")
      .not("normalized_result", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!collection) {
      console.info("[live] no completed trend collection — skipping market check");
      return;
    }

    const args = { collectionId: collection.id, workspaceId: collection.workspace_id };
    const scope = { workspaceId: collection.workspace_id, route: "market-intelligence" };
    const first = await runWithScope(scope, () => analyzeMarketCollection(args));
    console.info(`[live] first analysis: ${first.state}`, first.error ?? "");
    expect(["completed", "cached"]).toContain(first.state);

    const second = await runWithScope(scope, () => analyzeMarketCollection(args));
    expect(second.state).toBe("cached");
    expect(callsFor("market-intelligence").length).toBeLessThanOrEqual(1);
  }, 150_000);
});
