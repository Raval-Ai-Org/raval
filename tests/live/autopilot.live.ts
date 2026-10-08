// Live check of Autopilot against the real Supabase project (reads .env). It
// starts a program in the first workspace it finds that has none, and drives
// the real worker over the real tables and RPCs:
//
//   plan → proposed pieces (Assist) → nothing is made before the plan is approved
//   the worker claim (leases once, skips what isn't due)
//   opportunities (one row per fingerprint) → pieces (one set per opportunity)
//   work beyond posts: only weekly jobs are queued; "reuse what worked" reads
//   real rows and makes nothing without results; the view reads the blog, the
//   week's numbers and the scores
//   history is append-only on the real database
//   the RPC endpoint refuses an anonymous caller (when a dev server answers at
//   AUTOPILOT_LIVE_BASE_URL, default http://localhost:8081)
//
// By default the two model calls are replaced with fixed answers, so the run
// spends nothing. Opt-in steps:
//   AUTOPILOT_LIVE_AI=yes        the real plan and opportunity prompts (a few cents)
//   AUTOPILOT_LIVE_GENERATE=yes  make one real post through Studio (credits)
// Nothing here ever schedules or publishes a post. Everything it creates is
// deleted.
//   npx vitest run --config vitest.live.config.ts tests/live/autopilot.live.ts
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const BASE = process.env.AUTOPILOT_LIVE_BASE_URL || "http://localhost:8081";
const REAL_AI = process.env.AUTOPILOT_LIVE_AI === "yes";
const GENERATE = process.env.AUTOPILOT_LIVE_GENERATE === "yes";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;
const WORKER = `autopilot-live-${Date.now()}`;

describeLive("Autopilot (live)", () => {
  let workspaceId = "";
  let ownerId = "";
  let programId = "";
  const opportunityIds: string[] = [];
  const looseActionIds: string[] = [];
  const contentIds: string[] = [];
  const jobIds: string[] = [];

  async function setup() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const engine = await import("@/server/autopilot/engine");
    const { supabaseAutopilotStore: store } = await import("@/server/autopilot/store.server");
    const { realPorts } = await import("@/server/autopilot/ports.server");
    const ports: typeof realPorts = REAL_AI
      ? realPorts
      : {
          ...realPorts,
          plan: {
            ...realPorts.plan,
            propose: async ({ slots }) =>
              slots.map((slot, i) => ({
                slot: slot.index,
                title: `Live check piece ${i + 1}: ${["onboarding", "pricing", "support", "results"][i % 4]} ${Date.now()}`,
                brief:
                  "Explain one problem our customers face and the single step that fixes it. End with a clear next step.",
                reason: "Live check of the planning step.",
              })),
          },
          scan: {
            ...realPorts.scan,
            rate: async (_ws, list) =>
              list.map((_c, index) => ({
                index,
                relevance: 85,
                why: "It touches how this brand positions itself.",
                action: "Create a post showing how you differ?",
                format: "social",
              })),
          },
        };
    return { supabaseAdmin, engine, store, ports };
  }

  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (contentIds.length) await supabaseAdmin.from("content_items").delete().in("id", contentIds);
    if (jobIds.length) await supabaseAdmin.from("studio_jobs").delete().in("id", jobIds);
    if (looseActionIds.length) {
      await supabaseAdmin.from("autopilot_actions").delete().in("id", looseActionIds);
    }
    if (programId) await supabaseAdmin.from("autopilot_programs").delete().eq("id", programId);
    if (opportunityIds.length) {
      await supabaseAdmin.from("marketing_opportunities").delete().in("id", opportunityIds);
    }
    if (workspaceId) {
      await supabaseAdmin
        .from("autopilot_actions")
        .delete()
        .eq("workspace_id", workspaceId)
        .like("dedupe_key", "live:%");
    }
  });

  it("plans a week on real tables and makes nothing before the plan is approved", async () => {
    const { supabaseAdmin, engine, store, ports } = await setup();

    const { data: members, error } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id, user_id")
      .eq("role", "owner")
      .order("created_at")
      .limit(25);
    expect(error).toBeNull();
    for (const m of members ?? []) {
      if (!(await store.liveProgram(m.workspace_id))) {
        workspaceId = m.workspace_id;
        ownerId = m.user_id;
        break;
      }
    }
    expect(workspaceId, "a workspace without a live Autopilot program").toBeTruthy();
    process.env[`FEATURE_FLAG_AUTOPILOT_ENABLED_WS_${workspaceId}`] = "true";

    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
    const program = await store.insertProgram({
      workspace_id: workspaceId,
      status: "running",
      mode: "assist",
      goal: "awareness",
      goal_note: "Live check. Safe to delete.",
      platforms: ["linkedin"],
      content_types: ["social"],
      posts_per_week: 3,
      weekdays: [],
      timezone: "UTC",
      starts_on: today,
      ends_on: end,
      credit_cap_per_week: 100,
      video_cap_per_week: 0,
      act_on_opportunities: false,
      acting_user_id: ownerId,
      created_by: ownerId,
      automations: ["geo_scan", "repurpose", "publish_articles", "weekly_report"],
    });
    programId = program.id;

    // One live program per workspace is the database's rule.
    await expect(store.insertProgram({ ...program, status: "paused" } as never)).rejects.toThrow();

    const [plan] = await store.insertActions([
      {
        workspace_id: workspaceId,
        program_id: programId,
        kind: "plan",
        status: "planned",
        dedupe_key: `plan:${programId}:1`,
        cycle: 1,
        title: "Plan the week",
      },
    ]);
    expect(plan).toBeTruthy();

    const first = await engine.runSweep(store, ports, { worker: WORKER, onlyId: plan.id, max: 1 });
    expect(first.claimed).toBe(1);
    expect(first.failed).toBe(0);

    const actions = await store.listActions(workspaceId, { limit: 100 });
    const mine = actions.filter((a) => a.program_id === programId);
    const pieces = mine.filter((a) => a.kind === "content");
    expect(mine.find((a) => a.id === plan.id)?.status).toBe("done");
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((a) => a.status === "proposed" && a.platform === "linkedin")).toBe(true);
    expect(pieces.every((a) => a.planned_for && Date.parse(a.planned_for) > Date.now())).toBe(true);
    expect(mine.some((a) => a.dedupe_key === `plan:${programId}:2`)).toBe(true);

    // Assist: proposed pieces are never claimed, so nothing can be made yet.
    const idle = await engine.runSweep(store, ports, {
      worker: WORKER,
      onlyId: pieces[0].id,
      max: 1,
    });
    expect(idle.claimed).toBe(0);

    const events = await store.listEvents(workspaceId, 20);
    expect(events.some((e) => e.kind === "plan_ready" && e.program_id === programId)).toBe(true);

    // The week's other work is queued once, and the view says what still needs connecting.
    // Sending articles to the website is not a weekly step, so it queues nothing.
    const tasks = mine.filter((a) => a.kind === "task");
    expect(tasks.map((t) => t.content_type).sort()).toEqual([
      "geo_scan",
      "repurpose",
      "weekly_report",
    ]);
    // The summary is for the week, so it is not due until the week is over.
    const report = tasks.find((t) => t.content_type === "weekly_report")!;
    expect(Date.parse(report.next_attempt_at)).toBeGreaterThan(Date.now() + 5 * 86_400_000);

    // "Reuse what worked" reads this workspace's measured posts from the real
    // table. Whatever it finds, it only ever adds a planned piece: nothing is
    // made, and in Assist nothing can be made before the plan is approved.
    const reuse = tasks.find((t) => t.content_type === "repurpose")!;
    const ran = await engine.runSweep(store, ports, { worker: WORKER, onlyId: reuse.id, max: 1 });
    expect(ran.failed).toBe(0);
    const reused = (await store.listActions(workspaceId, { limit: 200 })).filter(
      (a) => a.program_id === programId && a.dedupe_key.startsWith("repurpose:"),
    );
    expect(reused.length).toBeLessThanOrEqual(1);
    expect(reused.every((a) => a.status === "proposed" && !a.studio_job_id)).toBe(true);
    expect((await store.getAction(workspaceId, reuse.id))?.status).toMatch(/^(done|skipped)$/);
    const { getAutopilotView } = await import("@/server/autopilot/service.server");
    const view = await getAutopilotView({ workspaceId, userId: ownerId, role: "owner" });
    expect(view.program?.id).toBe(programId);
    expect(view.readiness.map((r) => r.id).sort()).toEqual([
      "accounts",
      "blog",
      "brand",
      "style",
      "website",
    ]);
    expect(view.proposed.length).toBe(pieces.length + reused.length);
    expect(view.tasks.map((t) => t.contentType).sort()).toEqual([
      "geo_scan",
      "repurpose",
      "weekly_report",
    ]);
    // Read from real rows: the blog articles would go to (if one is connected)
    // and the last seven days.
    expect(view.site === null || view.site.host.length > 0).toBe(true);
    expect(view.readiness.find((r) => r.id === "blog")?.ok).toBe(view.site !== null);
    expect(view.week.posted).toBeGreaterThanOrEqual(0);
    expect(view.week.views).toBeGreaterThanOrEqual(0);

    // Planning the same week again adds no second set of pieces.
    const again = await store.insertActions(
      pieces.map((a) => ({
        workspace_id: workspaceId,
        program_id: programId,
        kind: "content" as const,
        dedupe_key: a.dedupe_key,
      })),
    );
    expect(again).toHaveLength(0);
  }, 120_000);

  it("leases a due piece once", async () => {
    const { engine, store } = await setup();
    if (!programId) return;
    const [row] = await store.insertActions([
      {
        workspace_id: workspaceId,
        program_id: programId,
        kind: "content",
        status: "planned",
        dedupe_key: `live:lease:${Date.now()}`,
        cycle: 1,
        platform: "linkedin",
        content_type: "social",
        title: "Lease check",
        brief: "Lease check",
        // A minute back, so a small clock difference with the database can't make it "not due".
        next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    const a = await store.claim(`${WORKER}-a`, 1, 60, row.id);
    const b = await store.claim(`${WORKER}-b`, 1, 60, row.id);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
    // A status change by a worker that doesn't hold the lease is refused.
    expect(await store.transition(a[0], "generating", {}, { worker: `${WORKER}-b` })).toBe(false);
    expect(await store.transition(a[0], "cancelled", {}, { worker: `${WORKER}-a` })).toBe(true);
    expect(engine.runSweep).toBeTypeOf("function");
  }, 60_000);

  it("keeps one opportunity per source and one set of pieces per opportunity", async () => {
    const { engine, store } = await setup();
    if (!workspaceId) return;
    const fingerprint = `competitor:https://example.com/live-check-${Date.now()}`;
    const row = {
      workspace_id: workspaceId,
      kind: "competitor" as const,
      title: "Live check: a competitor launched something",
      summary: "Synthetic row from the live check.",
      why_relevant: "It touches how this brand positions itself.",
      suggested_action: "Create a post showing how you differ?",
      suggested_type: "social",
      suggested_platforms: ["linkedin"],
      evidence: [{ title: "Example", url: "https://example.com/live-check", date: null }],
      source_kind: "competitor_update",
      source_id: null,
      fingerprint,
      score: 80,
      score_parts: {},
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const first = await store.insertOpportunities([row]);
    const second = await store.insertOpportunities([row]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    opportunityIds.push(first[0].id);

    const args = {
      opportunity: first[0],
      program: null,
      format: "campaign" as const,
      platforms: ["linkedin"],
      requestedBy: ownerId,
      now: new Date(Date.now() + 365 * 86_400_000),
    };
    const made = await engine.actionsFromOpportunity(store, args);
    const repeat = await engine.actionsFromOpportunity(store, args);
    expect(made).toHaveLength(3);
    expect(repeat).toHaveLength(0);
    looseActionIds.push(...made.map((a) => a.id));
    expect(made.every((a) => a.brief.includes("https://example.com/live-check"))).toBe(true);
    // Not due for a year, so no worker picks these up before cleanup.
    expect(made.every((a) => Date.parse(a.next_attempt_at) > Date.now())).toBe(true);
  }, 60_000);

  it("refuses to change or delete history on the real database", async () => {
    const { supabaseAdmin } = await setup();
    if (!programId) return;
    const { data: event } = await supabaseAdmin
      .from("autopilot_events")
      .select("id")
      .eq("program_id", programId)
      .limit(1)
      .single();
    expect(event?.id).toBeTruthy();
    const update = await supabaseAdmin
      .from("autopilot_events")
      .update({ summary: "changed" })
      .eq("id", event!.id);
    expect(update.error?.message ?? "").toMatch(/append-only/);
    const del = await supabaseAdmin.from("autopilot_events").delete().eq("id", event!.id);
    expect(del.error?.message ?? "").toMatch(/append-only/);
  }, 60_000);

  it.runIf(GENERATE)(
    "makes one real post through Studio and holds it for approval",
    async () => {
      const { supabaseAdmin, engine, store, ports } = await setup();
      const pieces = (
        await store.listActions(workspaceId, { statuses: ["proposed"], limit: 20 })
      ).filter((a) => a.program_id === programId);
      expect(pieces.length).toBeGreaterThan(0);
      const piece = pieces[0];
      expect(
        await store.transition(piece, "planned", { next_attempt_at: new Date().toISOString() }),
      ).toBe(true);

      await engine.runSweep(store, ports, {
        worker: WORKER,
        onlyId: piece.id,
        max: 1,
        budgetMs: 110_000,
      });
      const made = (await store.getAction(workspaceId, piece.id))!;
      if (made.studio_job_id) jobIds.push(made.studio_job_id);
      contentIds.push(...made.content_item_ids);
      expect(made.status, made.last_error ?? "").toBe("needs_approval");
      expect(made.content_item_ids.length).toBeGreaterThan(0);

      const { data: item } = await supabaseAdmin
        .from("content_items")
        .select("status, meta")
        .eq("id", made.content_item_ids[0])
        .single();
      expect(item?.status).toBe("pending");
      expect((item?.meta as Record<string, unknown>).autopilot_action_id).toBe(piece.id);

      // Not approved: another pass leaves it waiting and schedules nothing.
      await engine.runSweep(store, ports, { worker: WORKER, onlyId: piece.id, max: 1 });
      const still = (await store.getAction(workspaceId, piece.id))!;
      expect(still.status).toBe("needs_approval");
      const { data: after } = await supabaseAdmin
        .from("content_items")
        .select("status, scheduled_at")
        .eq("id", made.content_item_ids[0])
        .single();
      expect(after?.status).toBe("pending");
      expect(after?.scheduled_at).toBeNull();
    },
    180_000,
  );

  it.runIf(REAL_AI)(
    "proposes a strategy and ready-to-go settings from the real Brand DNA",
    async () => {
      const { suggestStrategy } = await import("@/server/autopilot/strategy.server");
      expect(workspaceId).toBeTruthy();
      const out = await suggestStrategy({
        workspaceId,
        userId: ownerId,
        timezone: "Europe/London",
      });
      console.info("[autopilot.live] strategy:", out.source, JSON.stringify(out.strategy));
      expect(out.strategy.summary.length).toBeGreaterThan(20);
      expect(out.strategy.pillars.length).toBeGreaterThanOrEqual(2);
      expect(out.settings.platforms.length).toBeGreaterThan(0);
      expect(out.settings.strategy).toEqual(out.strategy);
      expect(out.settings.timezone).toBe("Europe/London");
    },
    90_000,
  );

  it("the RPC endpoint refuses an anonymous caller", async () => {
    let response: Response;
    try {
      response = await fetch(`${BASE}/api/rpc/autopilot/getAutopilot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: { workspaceId: workspaceId || "00000000-0000-4000-8000-000000000000" },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      console.warn(`[autopilot.live] no dev server at ${BASE}; skipping the HTTP check`);
      return;
    }
    expect(response.status).toBe(401);
  }, 30_000);
});
