// Live check of Audience against the real Supabase project (reads .env). It
// picks the first workspace that has no audience groups yet and drives the real
// store, the real claim RPC and the real worker:
//
//   groups saved → quick score (stored once, answered from the row after)
//   a check: one run per key → leased → two stages → a stored result + history
//   a comparison: ranked versions
//   cancelling a queued run; history is append-only on the real database
//   a frozen result → calibration; a second result for the same post is refused
//   scoring leaves the piece's status and updated_at exactly as they were
//   the RPC endpoint refuses an anonymous caller (when a dev server answers at
//   AUDIENCE_LIVE_BASE_URL, default http://localhost:8081)
//
// By default every model call is replaced with a fixed answer, so the run
// spends nothing. AUDIENCE_LIVE_AI=yes uses the real prompts (a few cents).
// Everything it creates is deleted.
//   npx vitest run --config vitest.live.config.ts tests/live/audience.live.ts
import { afterAll, describe, expect, it } from "vitest";
import type { Dimensions, Subject } from "@/lib/audience/contracts";
import type { AudiencePorts } from "@/server/audience/engine";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const BASE = process.env.AUDIENCE_LIVE_BASE_URL || "http://localhost:8081";
const REAL_AI = process.env.AUDIENCE_LIVE_AI === "yes";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;
const WORKER = `audience-live-${Date.now()}`;
const STAMP = Date.now();

const dims = (n: number): Dimensions => ({ fit: n, hook: n, clarity: n, trust: n, cta: n });

const subject: Subject = {
  kind: "post",
  platform: "linkedin",
  title: `Audience live check ${STAMP}`,
  body: `Most teams lose an hour a day to status updates (${STAMP}). We cut ours to ten minutes with one shared board. Want the template? Reply and we'll send it.`,
};

describeLive("Audience (live)", () => {
  let workspaceId = "";
  let ownerId = "";
  let contentId = "";
  const runIds: string[] = [];
  const predictionIds: string[] = [];
  let scoreCalls = 0;

  async function setup() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const engine = await import("@/server/audience/engine");
    const { supabaseAudienceStore: store } = await import("@/server/audience/store.server");
    const { realPorts } = await import("@/server/audience/simulate.server");
    const fixed: AudiencePorts = {
      ...realPorts,
      // Never settle a charge or touch caches from a test.
      finished: () => undefined,
      changed: () => undefined,
      score: async (_actor, _twins, pieces) => {
        scoreCalls++;
        return {
          pieces: pieces.map((p) => ({
            index: p.index,
            dimensions: dims(72),
            why: "It names a problem these people have every day.",
            fixes: ["Say who the template is for"],
          })),
        };
      },
      react: async (_actor, twin, _subject, people) => ({
        dimensions: dims(twin.slug.endsWith("leads") ? 78 : 64),
        people: Array.from({ length: people }, (_, i) => ({
          who: `Person ${i + 1}`,
          stance: i % 3 === 0 ? "like" : i % 3 === 1 ? "neutral" : "skip",
          quote: "I'd want to see the board first.",
          wouldAct: i === 0,
        })),
        likes: ["A real number in the first line"],
        objections: ["No picture of the board"],
      }),
      synthesize: async () => ({
        why: "People liked the number but wanted to see the board.",
        fixes: ["Show the board"],
      }),
      writeVariants: async () => [
        {
          label: "Lead with the hour",
          title: "",
          body: "An hour a day, gone to status updates. Here is how we got it back. Want the template?",
        },
        {
          label: "Ask first",
          title: "",
          body: "How long did status updates take you today? Ours take ten minutes. Want the template?",
        },
      ],
      judge: async (_actor, _twin, versions, people) => ({
        versions: versions.map((_v, index) => ({
          index,
          dimensions: dims(index === 1 ? 82 : 60),
          picks: index === 1 ? people : 0,
          reason: index === 1 ? "The number comes first." : "Slower to the point.",
        })),
      }),
    };
    const ports: AudiencePorts = REAL_AI
      ? { ...realPorts, finished: () => undefined, changed: () => undefined }
      : fixed;
    return { supabaseAdmin, engine, store, ports };
  }

  afterAll(async () => {
    if (!workspaceId) return;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    // Outcomes go with their predictions, events with their runs.
    await db.from("audience_predictions").delete().eq("workspace_id", workspaceId);
    await db.from("audience_runs").delete().eq("workspace_id", workspaceId);
    await db.from("audience_calibration").delete().eq("workspace_id", workspaceId);
    await db.from("audience_twins").delete().eq("workspace_id", workspaceId);
    if (contentId) await db.from("content_items").delete().eq("id", contentId);
  });

  it("saves groups for a workspace that had none", async () => {
    const { supabaseAdmin, engine, store } = await setup();
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { data: members, error } = await db
      .from("workspace_members")
      .select("workspace_id, user_id")
      .eq("role", "owner")
      .order("created_at")
      .limit(40);
    expect(error).toBeNull();
    for (const m of (members ?? []) as { workspace_id: string; user_id: string }[]) {
      const [twins, runs, predictions] = await Promise.all([
        db.from("audience_twins").select("id").eq("workspace_id", m.workspace_id).limit(1),
        db.from("audience_runs").select("id").eq("workspace_id", m.workspace_id).limit(1),
        db.from("audience_predictions").select("id").eq("workspace_id", m.workspace_id).limit(1),
      ]);
      // Only a workspace with no audience data at all, so cleanup removes nothing real.
      if (!twins.data?.length && !runs.data?.length && !predictions.data?.length) {
        workspaceId = m.workspace_id;
        ownerId = m.user_id;
        break;
      }
    }
    expect(workspaceId, "a workspace with no audience data").not.toBe("");

    const { makeTrait } = await import("@/lib/audience/twins");
    const draft = (slug: string, name: string, weight: number) => ({
      slug,
      name,
      segment: "Live check",
      summary: "",
      weight,
      profile: [
        makeTrait("goal", "Fewer meetings", "brand_dna"),
        makeTrait("pain", "Status updates eat the day", "brand_dna"),
        makeTrait("objection", "Another tool to learn", "assumed"),
        makeTrait("trigger", "A missed deadline", "user"),
      ],
      origin: "generated" as const,
      origin_ref: null,
    });
    const out = await engine.saveTwinDrafts(
      store,
      workspaceId,
      [draft("live-team-leads", "Team leads", 60), draft("live-founders", "Founders", 40)],
      ownerId,
    );
    expect(out.added).toBe(2);
    const twins = await store.listTwins(workspaceId);
    expect(twins.map((t) => t.slug).sort()).toEqual(["live-founders", "live-team-leads"]);
    expect(twins[0].profile.some((t) => t.source === "assumed")).toBe(true);

    // The same drafts again change nothing (no version bump, no new row).
    const again = await engine.saveTwinDrafts(
      store,
      workspaceId,
      [draft("live-team-leads", "Team leads", 60)],
      ownerId,
    );
    expect(again).toMatchObject({ added: 0, updated: 0 });
  }, 60_000);

  it("scores a saved piece once, and leaves the piece exactly as it was", async () => {
    const { supabaseAdmin, engine, store, ports } = await setup();
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { data: created, error } = await db
      .from("content_items")
      .insert({
        workspace_id: workspaceId,
        kind: "social",
        channel: "linkedin",
        title: subject.title,
        body: subject.body,
        status: "pending",
        created_by: ownerId,
        meta: { studio_type: "social", platform: "linkedin", source: "audience-live" },
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    contentId = (created as { id: string }).id;
    await db.from("content_items").update({ status: "approved" }).eq("id", contentId);
    const read = async () =>
      (
        await db
          .from("content_items")
          .select("status, updated_at, body")
          .eq("id", contentId)
          .single()
      ).data as { status: string; updated_at: string; body: string };
    const before = await read();

    const { subjectFromContent } = await import("@/lib/audience/subject");
    const scored = subjectFromContent({
      kind: "social",
      channel: "linkedin",
      title: subject.title,
      body: before.body,
      meta: { studio_type: "social", platform: "linkedin" },
    })!;
    const actor = { workspaceId, userId: ownerId };
    const item = { ...scored, contentItemId: contentId };
    const [first] = await engine.scoreSubjects({ store, ports }, actor, [item]);
    expect(first).not.toBeNull();
    predictionIds.push(first!.id);
    expect(first!.overall).toBeGreaterThanOrEqual(0);
    expect(first!.overall).toBeLessThanOrEqual(100);
    expect(first!.content_item_id).toBe(contentId);
    expect(first!.result.confidence).toBe("low");

    const calls = scoreCalls;
    const [second] = await engine.scoreSubjects({ store, ports }, actor, [item]);
    expect(second!.id).toBe(first!.id);
    if (!REAL_AI) expect(scoreCalls).toBe(calls);

    // Scoring never touches the piece: same status, same updated_at.
    expect(await read()).toEqual(before);
  }, 120_000);

  it("runs a check once per key, in two leased stages, and stores the result", async () => {
    const { supabaseAdmin, engine, store, ports } = await setup();
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const key = `pulse:live-${STAMP}`;
    const row = {
      workspace_id: workspaceId,
      kind: "pulse" as const,
      idempotency_key: key,
      input: { subject, contentType: "social" },
      content_item_id: contentId,
      created_by: ownerId,
    };
    const first = await store.insertRun(row);
    const second = await store.insertRun(row);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    runIds.push(first.run.id);

    // The real claim RPC leases it once.
    const mine = await store.claim(WORKER, 1, 60, first.run.id);
    expect(mine).toHaveLength(1);
    expect(await store.claim(`${WORKER}-other`, 1, 60, first.run.id)).toHaveLength(0);
    await store.updateRun(mine[0], WORKER, {});

    const sweep = await engine.runSweep(store, ports, {
      worker: WORKER,
      onlyId: first.run.id,
      budgetMs: 150_000,
    });
    expect(sweep.failed).toBe(0);
    const done = await store.getRun(workspaceId, first.run.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.progress).toEqual({ done: 3, total: 3 });

    const [prediction] = await store.listPredictions(workspaceId, { runId: first.run.id });
    expect(prediction.depth).toBe("pulse");
    expect(prediction.result.pulse?.people).toBeGreaterThanOrEqual(6);
    predictionIds.push(prediction.id);
    const events = await store.listEvents(workspaceId, first.run.id);
    expect(events.map((e) => e.kind)).toContain("result_ready");

    // History cannot be rewritten, even by the service role.
    const { error } = await db
      .from("audience_run_events")
      .update({ summary: "changed" })
      .eq("run_id", first.run.id);
    expect(error?.message ?? "").toMatch(/append-only/);

    // A piece the audience row does not belong to is refused by the database.
    const foreign = await db.from("audience_runs").insert({
      workspace_id: "00000000-0000-4000-8000-000000000000",
      kind: "pulse",
      idempotency_key: `pulse:foreign-${STAMP}`,
      content_item_id: contentId,
    });
    expect(foreign.error).not.toBeNull();
  }, 200_000);

  it("compares versions and names a winner", async () => {
    const { engine, store, ports } = await setup();
    const { run } = await store.insertRun({
      workspace_id: workspaceId,
      kind: "tournament",
      idempotency_key: `tournament:live-${STAMP}`,
      input: { subject, contentType: "social" },
      content_item_id: contentId,
      created_by: ownerId,
    });
    runIds.push(run.id);
    // A slow provider answer is retried by the worker, as the cron would.
    let done = await store.getRun(workspaceId, run.id);
    for (let i = 0; i < 4 && done && (done.status === "queued" || done.status === "running"); i++) {
      if (i) await new Promise((r) => setTimeout(r, 45_000));
      await engine.runSweep(store, ports, { worker: WORKER, onlyId: run.id, budgetMs: 150_000 });
      done = await store.getRun(workspaceId, run.id);
    }
    expect(done?.status).toBe("succeeded");
    const output = done!.output as {
      variants: { isOriginal: boolean; rank: number; overall: number }[];
      winnerIndex: number | null;
      summary: string;
    };
    expect(output.variants.length).toBeGreaterThanOrEqual(2);
    expect(output.variants[0].isOriginal).toBe(true);
    expect(output.winnerIndex).not.toBeNull();
    expect(output.variants.map((v) => v.rank).sort()).toEqual(
      output.variants.map((_v, i) => i + 1),
    );
    expect(output.summary.length).toBeGreaterThan(5);
  }, 420_000);

  it("cancels a queued run without starting it", async () => {
    const { engine, store, ports } = await setup();
    const { run } = await store.insertRun({
      workspace_id: workspaceId,
      kind: "pulse",
      idempotency_key: `pulse:cancel-${STAMP}`,
      input: { subject: { ...subject, body: `${subject.body} Again.` }, contentType: "social" },
      created_by: ownerId,
    });
    runIds.push(run.id);
    const cancelled = await store.requestCancel(workspaceId, run.id);
    expect(cancelled?.status).toBe("cancelled");
    const sweep = await engine.runSweep(store, ports, { worker: WORKER, onlyId: run.id });
    expect(sweep.claimed).toBe(0);
  }, 60_000);

  it("freezes one real result and learns from it", async () => {
    const { store } = await setup();
    const { relearn } = await import("@/server/audience/learn.server");
    const base = {
      workspace_id: workspaceId,
      prediction_id: predictionIds[0],
      content_item_id: contentId,
      platform: "linkedin",
      content_type: "social",
      title: subject.title,
      horizon: "d7" as const,
      metrics: { views: 1200, likes: 40, comments: 6, shares: 3, saves: 5 },
      engagement: 0.06333,
      predicted: 72,
      actual: 55,
      delivered_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    };
    expect(await store.insertOutcome(base)).toBe(true);
    // The same post never gets a second result, from this or another prediction.
    expect(await store.insertOutcome(base)).toBe(false);
    expect(await store.insertOutcome({ ...base, prediction_id: predictionIds[1] })).toBe(false);

    await relearn(workspaceId);
    const all = await store.getCalibration(workspaceId, "all", "all");
    expect(all).toMatchObject({ n: 1, bias: 17, mae: 17 });
    // One post is not a pattern, and not enough to correct anything.
    expect(all?.learned).toEqual([]);
    const { applyCalibration } = await import("@/lib/audience/calibration");
    expect(applyCalibration(70, all)).toMatchObject({ overall: 70, calibrated: false });
    const twins = await store.listTwins(workspaceId);
    expect(twins.some((t) => t.kind === "overall")).toBe(false);
  }, 60_000);

  it("refuses an anonymous caller at the RPC endpoint", async () => {
    let response: Response;
    try {
      response = await fetch(`${BASE}/api/rpc/audience/getAudience`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { workspaceId } }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      console.warn(`[audience.live] no dev server at ${BASE}; skipped the RPC check`);
      return;
    }
    expect(response.status).toBe(401);
  }, 30_000);
});
