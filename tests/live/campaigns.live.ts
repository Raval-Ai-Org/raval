// Live check of Campaigns (ADR-0039) against the real Supabase project (reads
// .env). It picks the workspace with the fullest Brand DNA and drives the real
// server code:
//
//   home reads: campaigns, suggestions and the Autopilot lane, nothing thrown
//   a draft: the brief is saved, the free skeleton lays out phases and pieces
//     around the key date, a foreign link is refused
//   a draft never reaches a generator (no "Campaigns running now" block)
//   a draft is deleted again afterwards
//
// By default no model is called and nothing is spent. CAMPAIGNS_LIVE_AI=yes
// also writes the plan with the real model (the 55-credit `campaign` action)
// and checks that what comes back is grounded.
//   npx vitest run --config vitest.live.config.ts tests/live/campaigns.live.ts
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const REAL_AI = process.env.CAMPAIGNS_LIVE_AI === "yes";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

describeLive("Campaigns (live)", () => {
  let workspaceId = "";
  let ownerId = "";
  let campaignId = "";

  async function admin() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin;
  }

  async function pick() {
    if (workspaceId) return;
    const db = await admin();
    const { data } = await db.from("workspace_brand_dna").select("workspace_id, dna").limit(200);
    const ranked = (data ?? [])
      .map((r) => ({ id: r.workspace_id as string, size: JSON.stringify(r.dna ?? {}).length }))
      .sort((a, b) => b.size - a.size);
    if (!ranked.length) return;
    workspaceId = ranked[0].id;
    const { data: members } = await db
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId);
    ownerId =
      (members ?? []).find((m) => m.role === "owner")?.user_id ?? members?.[0]?.user_id ?? "";
  }

  const caller = () => ({ workspaceId, userId: ownerId, role: "owner" as const });
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  afterAll(async () => {
    if (!campaignId) return;
    const svc = await import("@/server/campaigns/service.server");
    await svc.deleteCampaign(caller(), campaignId).catch(() => undefined);
  });

  it("reads home without throwing", async () => {
    await pick();
    if (!workspaceId) return;
    const svc = await import("@/server/campaigns/service.server");
    const home = await svc.getCampaignsHome(caller());
    expect(Array.isArray(home.campaigns)).toBe(true);
    expect(home.price.plan).toBeGreaterThan(0);
  }, 60_000);

  it("saves a draft laid out around its key date, and refuses a foreign link", async () => {
    await pick();
    if (!workspaceId) return;
    const svc = await import("@/server/campaigns/service.server");
    const brief = {
      type: "event",
      name: "Live check open evening",
      about: "An evening event for the live check.",
      startsOn: inDays(2),
      keyDate: inDays(16),
      channels: ["instagram", "linkedin"],
      pace: "steady",
      stories: true,
      timezone: "Europe/London",
      goal: { kind: "registrations", target: 100, link: "https://example.com/register" },
    };
    const view = await svc.saveCampaign(caller(), { id: null, brief });
    campaignId = view.id;
    expect(view.status).toBe("draft");
    expect(view.plan.phases.length).toBeGreaterThan(2);
    expect(view.pieces.length).toBeGreaterThan(4);
    expect(view.pieces.every((p) => p.date >= view.startsOn && p.date <= view.endsOn)).toBe(true);
    expect(view.pieces.some((p) => p.format === "story" && p.platform === "instagram")).toBe(true);
    expect(view.pieces.some((p) => p.format === "story" && p.platform === "linkedin")).toBe(false);

    await expect(
      svc.saveCampaign(caller(), {
        id: campaignId,
        brief: { ...brief, goal: { ...brief.goal, link: "http://127.0.0.1/form" } },
      }),
    ).rejects.toThrow();
  }, 60_000);

  it("keeps a draft away from generators", async () => {
    await pick();
    if (!workspaceId || !campaignId) return;
    const { campaignBlockFor } = await import("@/server/campaigns/context.server");
    const block = await campaignBlockFor(workspaceId);
    expect(block).not.toContain("Live check open evening");
  }, 30_000);

  it.runIf(REAL_AI)(
    "writes a grounded plan with the real model",
    async () => {
      await pick();
      if (!workspaceId || !campaignId) return;
      const svc = await import("@/server/campaigns/service.server");
      const view = await svc.planCampaign(caller(), {
        campaignId,
        idempotencyKey: `campaign-plan:live:${campaignId}`,
      });
      expect(view.status).toBe("ready");
      expect(view.plan.written).toBe(true);
      const text = view.pieces.map((p) => `${p.title} ${p.idea}`).join(" ");
      expect(text).not.toMatch(/https?:\/\/(?!example\.com)/);
    },
    240_000,
  );
});
