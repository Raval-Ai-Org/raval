// Live check of Brain and the marketing strategy against the real Supabase
// project (reads .env). It picks the workspace with the fullest Brand DNA and
// drives the real server code:
//
//   the overview: four brains, updates newest first, nothing thrown
//   the brand look resolves from Brand DNA on the server
//   strategy sources: Brand DNA is found; the fingerprint is stable
//   a strategy: a draft never reaches a generator; once confirmed it is in the
//     prompt context Studio, chat and Autopilot read; a stale version is refused
//
// By default no model is called and nothing is spent: the strategy is a fixed
// one, saved to a workspace that has no strategy and no live Autopilot program,
// and deleted again afterwards. STRATEGY_LIVE_AI=yes also asks the real model
// for one (premium call, a few cents) and checks what comes back is grounded.
//   npx vitest run --config vitest.live.config.ts tests/live/brain.live.ts
import { afterAll, describe, expect, it } from "vitest";
import type { MarketingStrategy } from "@/lib/strategy/contracts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const REAL_AI = process.env.STRATEGY_LIVE_AI === "yes";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

const fixture = (): MarketingStrategy => ({
  v: 1,
  positioning: {
    statement: "A live-check strategy that helps small teams look consistent everywhere.",
    promise: "One plan, followed everywhere",
    differentiators: ["Written from real data"],
  },
  goal: {
    type: "awareness",
    summary: "Be known by the right people.",
    metric: "Profile visits",
    target: "",
  },
  audiences: [],
  voice: "Plain and warm",
  pillars: [
    { title: "Helpful tips", detail: "One thing to use today.", share: 60 },
    { title: "Behind the scenes", detail: "The people and the work.", share: 40 },
  ],
  channels: [{ platform: "linkedin", role: "Reach", perWeek: 3, formats: ["post"] }],
  messages: { attract: "Notice us", convince: "Trust us", convert: "Try us", keep: "Stay" },
  // An invented competitor and an invented source: both must be dropped on save.
  competitors: [
    {
      competitorId: "00000000-0000-4000-8000-000000000000",
      name: "Nobody Ltd",
      theirAngle: "",
      ourEdge: "We are real",
    },
  ],
  plays: [
    {
      title: "Ride a made-up trend",
      detail: "",
      sourceUrl: "https://nowhere.invalid/x",
      sourceTitle: "",
    },
  ],
  roadmap: [{ phase: "Days 1–30", focus: "Set the base", actions: ["Post three times a week"] }],
  kpis: [{ label: "Profile visits", target: "", why: "The goal" }],
  rules: { do: ["Lead with the benefit"], dont: ["No jargon"] },
});

describeLive("Brain and strategy (live)", () => {
  let workspaceId = "";
  let ownerId = "";
  /** A workspace we may write a strategy to and remove again. */
  let scratchId = "";
  let created = false;

  async function admin() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin;
  }

  async function pick() {
    if (workspaceId) return;
    const db = await admin();
    const { data: dnaRows } = await db
      .from("workspace_brand_dna")
      .select("workspace_id, dna")
      .limit(200);
    const ranked = (dnaRows ?? [])
      .map((r) => ({ id: r.workspace_id as string, size: JSON.stringify(r.dna ?? {}).length }))
      .filter((r) => r.size > 400)
      .sort((a, b) => b.size - a.size);
    if (!ranked.length) return;
    workspaceId = ranked[0].id;
    const { data: members } = await db
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId);
    ownerId =
      (members ?? []).find((m) => m.role === "owner")?.user_id ?? members?.[0]?.user_id ?? "";

    const [{ data: taken }, { data: live }] = await Promise.all([
      db.from("workspace_marketing_strategy" as never).select("workspace_id"),
      db.from("autopilot_programs").select("workspace_id").in("status", ["running", "paused"]),
    ]);
    const busy = new Set(
      [...((taken ?? []) as { workspace_id: string }[]), ...(live ?? [])].map(
        (r) => r.workspace_id,
      ),
    );
    scratchId = ranked.find((r) => !busy.has(r.id))?.id ?? "";
  }

  afterAll(async () => {
    if (!created || !scratchId) return;
    const db = await admin();
    await db
      .from("workspace_marketing_strategy" as never)
      .delete()
      .eq("workspace_id", scratchId);
    const { invalidateStrategyContext } = await import("@/server/strategy/context.server");
    const { invalidateStudioContext } = await import("@/server/studio/context.server");
    invalidateStrategyContext(scratchId);
    invalidateStudioContext(scratchId);
  });

  it("reads all four brains and what changed, in one call", async () => {
    await pick();
    if (!workspaceId) return console.warn("[brain live] no workspace with Brand DNA; skipped");
    const { loadBrainOverview } = await import("@/server/brain/overview.server");
    const overview = await loadBrainOverview((await admin()) as never, workspaceId);
    expect(Object.keys(overview.brains).sort()).toEqual([
      "audience",
      "brand",
      "competitors",
      "market",
    ]);
    expect(overview.brains.brand.ready).toBe(true);
    expect(overview.brains.brand.health).toBeGreaterThan(0);
    const times = overview.updates.map((u) => Date.parse(u.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set(overview.updates.map((u) => u.id)).size).toBe(overview.updates.length);
    console.log(
      "[brain live]",
      Object.entries(overview.brains)
        .map(([k, b]) => `${k} ${b.health}`)
        .join(" · "),
      `· ${overview.updates.length} updates · needs: ${overview.needs.map((n) => n.id).join(", ") || "none"}`,
    );
  });

  it("resolves the brand look on the server from Brand DNA", async () => {
    if (!workspaceId) return;
    const { loadBrandLook, lookTextFor } = await import("@/server/brand-look/resolve.server");
    const { look, dna } = await loadBrandLook(workspaceId);
    expect(dna).toBeTruthy();
    expect(look.rules).toBeDefined();
    const text = await lookTextFor(workspaceId, "social");
    // A brand with nothing set beyond its facts adds no style text.
    expect(look.customized ? text.length > 0 : text === "").toBe(true);
    console.log(
      `[brain live] look customized=${look.customized}, palette=${look.visual.palette.primary ?? "none"}`,
    );
  });

  it("gathers strategy sources with a stable fingerprint", async () => {
    if (!workspaceId) return;
    const { gatherStrategySources } = await import("@/server/strategy/sources.server");
    const a = await gatherStrategySources(workspaceId);
    const b = await gatherStrategySources(workspaceId);
    expect(a.available.brand).toBe(true);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.text.brand.length).toBeGreaterThan(120);
    console.log("[brain live] strategy can use:", JSON.stringify(a.available));
  });

  it("only a confirmed strategy reaches the generators, and edits stay grounded", async () => {
    if (!scratchId || !ownerId) {
      return console.warn("[brain live] no free workspace to write a strategy to; skipped");
    }
    const db = await admin();
    const service = await import("@/server/strategy/service.server");
    const { strategyBlockFor, invalidateStrategyContext } =
      await import("@/server/strategy/context.server");
    const { loadStudioContext, invalidateStudioContext } =
      await import("@/server/studio/context.server");
    const caller = { workspaceId: scratchId, userId: ownerId, role: "owner" as const };

    const { error } = await db.from("workspace_marketing_strategy" as never).insert({
      workspace_id: scratchId,
      strategy: fixture(),
      status: "draft",
      version: 1,
      generations: 1,
      generated_at: new Date().toISOString(),
    } as never);
    expect(error).toBeNull();
    created = true;

    // A draft is shown to people and never to a generator.
    const draft = await service.getStrategyView(caller);
    expect(draft.status).toBe("draft");
    expect(draft.nextIsFree).toBe(false);
    invalidateStrategyContext(scratchId);
    expect(await strategyBlockFor(scratchId)).toBe("");

    // Saving with a stale version is refused.
    await expect(
      service.saveStrategy(caller, { strategy: fixture(), version: 99, confirm: true }),
    ).rejects.toMatchObject({ status: 409 });

    await service.saveStrategy(caller, { strategy: fixture(), version: 1, confirm: true });
    const confirmed = await service.getStrategyView(caller);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.version).toBe(2);
    // The invented competitor and the invented source did not survive.
    expect(confirmed.strategy?.competitors).toEqual([]);
    expect(confirmed.strategy?.plays).toEqual([]);

    const block = await strategyBlockFor(scratchId);
    expect(block).toContain("## Marketing strategy");
    expect(block).toContain("Helpful tips 60%");
    invalidateStudioContext(scratchId);
    const ctx = await loadStudioContext(db as never, scratchId, null);
    expect(ctx.brandText).toContain("## Marketing strategy");

    // Autopilot's one-time setup proposes the confirmed strategy, without a model call.
    const { suggestStrategy } = await import("@/server/autopilot/strategy.server");
    const suggestion = await suggestStrategy({
      workspaceId: scratchId,
      userId: ownerId,
      timezone: "UTC",
    });
    expect(suggestion.strategy.pillars.map((p) => p.title)).toEqual([
      "Helpful tips",
      "Behind the scenes",
    ]);
    expect(suggestion.settings.goal).toBe("awareness");
  });

  it.skipIf(!REAL_AI)(
    "the real model writes a grounded strategy",
    async () => {
      if (!workspaceId || !ownerId) return;
      const { gatherStrategySources } = await import("@/server/strategy/sources.server");
      const { generateStrategy } = await import("@/server/strategy/generate.server");
      const sources = await gatherStrategySources(workspaceId);
      const strategy = await generateStrategy({ workspaceId, userId: ownerId, sources });
      expect(strategy).not.toBeNull();
      const ids = new Set(sources.facts.competitors.map((c) => c.id));
      const urls = new Set(sources.facts.sources.map((s) => s.url));
      for (const c of strategy!.competitors) expect(ids.has(c.competitorId)).toBe(true);
      for (const p of strategy!.plays) expect(urls.has(p.sourceUrl)).toBe(true);
      expect(strategy!.pillars.reduce((n, p) => n + p.share, 0)).toBe(100);
      console.log("[brain live] strategy:\n" + JSON.stringify(strategy, null, 2));
    },
    180_000,
  );
});
