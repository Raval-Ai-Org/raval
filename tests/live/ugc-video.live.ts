// Live UGC Video Ads end to end against the REAL Supabase project, OpenRouter and
// Kie.ai (reads .env). Creates two temporary users and a workspace, then:
//   product page extraction → project (RLS client) → grounded concepts (OpenRouter)
//   → reference image import → allowance reservation → a real Kie render
//   (`draft` = Veo 3.1 Lite on KIE: ~30 Kie credits) → storage + Library
//   asset → reservation captured once → signed playback + download links.
// Also: a real provider-side failure releases the hold, a double submit makes
// one render, an exhausted plan refuses the render, and another tenant can't
// see any of it. Everything created is removed at the end.
//
// Opt-in (spends ~$0.15 of Kie credits + a few cents of OpenRouter):
//   npx vitest run --config vitest.live.config.ts tests/live/ugc-video.live.ts
// UGC_LIVE_PRODUCT_URL picks the product page.
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
  !!process.env.SUPABASE_PUBLISHABLE_KEY &&
  !!process.env.KIE_API_KEY &&
  !!process.env.OPENROUTER_API_KEY;

const PRODUCT_URL =
  process.env.UGC_LIVE_PRODUCT_URL || "https://www.glossier.com/products/boy-brow";
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1024&fm=jpg";

type Actor = { id: string; db: SupabaseClient };

let admin: SupabaseClient;
let alice: Actor;
let bob: Actor;
let workspaceId = "";
let projectId = "";
let referenceAssetId = "";
const users: string[] = [];

async function makeActor(tag: string): Promise<Actor> {
  const { createClient } = await import("@supabase/supabase-js");
  const email = `ugc-live-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  users.push(data.user.id);
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session) throw new Error(`sign in failed: ${signInError?.message}`);
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  return { id: data.user.id, db };
}

/** Advance a render like the cron hook would, until it settles. */
async function settle(renderId: string, maxMs = 6 * 60_000) {
  const { renderEngine } = await import("@/server/ugc/service.server");
  const { supabaseUgcStore } = await import("@/server/ugc/store.supabase.server");
  const started = Date.now();
  for (;;) {
    await renderEngine.runDue({ worker: "live-test", budgetMs: 30_000, max: 1, id: renderId });
    const row = await supabaseUgcStore.getRender(renderId);
    if (row && ["succeeded", "failed", "cancelled"].includes(row.status)) return row;
    if (Date.now() - started > maxMs)
      throw new Error(`render still ${row?.status} after ${maxMs}ms`);
    await new Promise((r) => setTimeout(r, 8000));
  }
}

(configured ? describe : describe.skip)("UGC video ads (live)", () => {
  beforeAll(async () => {
    const mod = await import("@/integrations/supabase/client.server");
    admin = mod.supabaseAdmin as unknown as SupabaseClient;
    alice = await makeActor("alice");
    bob = await makeActor("bob");
    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const ws = await createOrGetWorkspace({
      userId: alice.id,
      name: "UGC Live Test",
      websiteUrl: `https://ugc-live-${randomUUID().slice(0, 8)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    workspaceId = ws.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    if (workspaceId) {
      const { data: assets } = await admin
        .from("assets")
        .select("storage_path")
        .eq("workspace_id", workspaceId);
      const paths = (assets ?? [])
        .map((a: { storage_path: string | null }) => a.storage_path)
        .filter(Boolean) as string[];
      if (paths.length) await admin.storage.from("generated-assets").remove(paths);
      await admin.from("ugc_renders").delete().eq("workspace_id", workspaceId);
      await admin.from("ai_usage_reservations").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it("reads a real product page into grounded facts", async () => {
    const { extractProduct } = await import("@/server/ugc/product-extract.server");
    const { product, analyzed } = await extractProduct(PRODUCT_URL);
    console.log("[ugc-live] product", {
      name: product.name,
      brand: product.brand,
      facts: product.facts.length,
      images: product.images.length,
      analyzed,
    });
    expect(product.name.length).toBeGreaterThan(2);
    expect(analyzed).toBe(true);
    expect(product.facts.length).toBeGreaterThan(0);

    // Import a product photo (page image, or a stable fallback) as a reference.
    const { importReferenceFromUrl } = await import("@/server/ugc/references.server");
    let ref;
    for (const url of [...product.images.map((i) => i.url).slice(0, 3), FALLBACK_IMAGE]) {
      try {
        ref = await importReferenceFromUrl(workspaceId, url);
        break;
      } catch (error) {
        console.log("[ugc-live] image skipped", url, (error as Error).message);
      }
    }
    expect(ref?.assetId).toBeTruthy();
    referenceAssetId = ref!.assetId;

    const { createProject } = await import("@/server/ugc/service.server");
    const project = await createProject(alice.db as never, {
      workspaceId,
      userId: alice.id,
      product,
      brief: { platform: "tiktok", objective: "sales", format: "review", tone: "authentic" },
      referenceAssetIds: [referenceAssetId],
    });
    projectId = project.id;
    expect(project.references[0]?.url).toMatch(/^https:\/\//);
  }, 180_000);

  it("writes grounded concepts and a script sized to the clip (Claude)", async () => {
    const { projectContext, saveConcepts } = await import("@/server/ugc/service.server");
    const { generateConcepts } = await import("@/server/ugc/concepts.server");
    const { dialogueWordBudget, scriptWordCount } = await import("@/lib/ugc/prompt");
    const ctx = await projectContext(alice.db as never, workspaceId, projectId);
    const concepts = await generateConcepts({
      product: ctx.product,
      brief: ctx.brief,
      brand: ctx.brand,
      workspace: ctx.workspace,
      durationSec: 8,
    });
    console.log(
      "[ugc-live] concepts",
      concepts.map((c) => ({
        title: c.title,
        hook: c.script.hook,
        words: scriptWordCount(c.script),
        warnings: c.warnings,
      })),
    );
    expect(concepts.length).toBeGreaterThanOrEqual(2);
    for (const c of concepts) {
      expect(c.script.scenes[c.script.scenes.length - 1].end).toBe(8);
      expect(scriptWordCount(c.script)).toBeLessThanOrEqual(dialogueWordBudget(8) + 6);
    }
    const view = await saveConcepts(alice.db as never, workspaceId, projectId, concepts, ctx.brand);
    expect(view.script?.hook).toBeTruthy();
  }, 300_000);

  it("another tenant sees nothing and cannot start a render", async () => {
    const { data: projects } = await bob.db
      .from("ugc_projects")
      .select("id")
      .eq("workspace_id", workspaceId);
    expect(projects ?? []).toHaveLength(0);
    const { getProjectView } = await import("@/server/ugc/service.server");
    await expect(getProjectView(bob.db as never, workspaceId, projectId)).rejects.toMatchObject({
      status: 404,
    });
    const { error } = await bob.db
      .from("ugc_renders")
      .insert({ workspace_id: workspaceId, project_id: projectId, idempotency_key: "x" } as never);
    expect(error).not.toBeNull();
  });

  it("refuses a render when the plan's video allowance is used up (no row, no hold)", async () => {
    const { startRender } = await import("@/server/ugc/service.server");
    const previous = process.env.PLAN_STARTER_MONTHLY_VIDEOS;
    process.env.PLAN_STARTER_MONTHLY_VIDEOS = "0";
    try {
      await expect(
        startRender(alice.db as never, {
          workspaceId,
          userId: alice.id,
          projectId,
          idempotencyKey: `blocked-${randomUUID()}`,
          model: "draft",
          durationSec: 8,
          aspectRatio: "9:16",
          resolution: "720p",
          referenceAssetIds: [referenceAssetId],
        }),
      ).rejects.toMatchObject({ name: "BudgetExceededError", status: 429 });
    } finally {
      if (previous === undefined) delete process.env.PLAN_STARTER_MONTHLY_VIDEOS;
      else process.env.PLAN_STARTER_MONTHLY_VIDEOS = previous;
    }
    const { count } = await admin
      .from("ugc_renders")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    expect(count).toBe(0);
  });

  it("renders a real video with Kie, stores it in the Library and captures the allowance once", async () => {
    const { startRender, getRenderView, renderDownload } =
      await import("@/server/ugc/service.server");
    const key = `live-${randomUUID()}`;
    const input = {
      workspaceId,
      userId: alice.id,
      projectId,
      idempotencyKey: key,
      model: "draft",
      durationSec: 8,
      aspectRatio: "9:16",
      resolution: "720p",
      referenceAssetIds: [referenceAssetId],
    };
    // Double submit: one render, one hold.
    const [a, b] = await Promise.all([
      startRender(alice.db as never, input),
      startRender(alice.db as never, input),
    ]);
    expect(a.render.id).toBe(b.render.id);
    const { data: holds } = await admin
      .from("ai_usage_reservations")
      .select("id, state")
      .eq("workspace_id", workspaceId);
    expect(holds).toHaveLength(1);
    expect(holds![0].state).toBe("held");

    const row = await settle(a.render.id);
    console.log("[ugc-live] render", {
      status: row.status,
      error: row.error_message,
      taskId: row.provider_task_id,
      cost: row.actual_cost_usd,
      provider: row.provider,
      providerModel: row.provider_model,
      generationType: row.generation_type,
    });
    expect(row.status).toBe("succeeded");
    // KIE takes product photos as references; OpenRouter's Veo opens on the photo.
    expect(row.generation_type).toBe(
      process.env.VIDEO_PROVIDER === "openrouter" ? "IMAGE_TO_VIDEO" : "REFERENCE_2_VIDEO",
    );
    expect(row.asset_id).toBeTruthy();
    expect(row.actual_cost_usd).toBeGreaterThan(0);

    const { data: asset } = await admin
      .from("assets")
      .select("asset_type, status, storage_path, metadata")
      .eq("id", row.asset_id!)
      .single();
    expect(asset).toMatchObject({ asset_type: "video", status: "ready" });
    expect((asset!.metadata as { source?: string }).source).toBe("ugc");

    const { data: hold } = await admin
      .from("ai_usage_reservations")
      .select("state, captured_cost_usd")
      .eq("id", row.reservation_id!)
      .single();
    expect(hold!.state).toBe("captured");
    const { count: usage } = await admin
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("request_id", `reservation:${row.reservation_id}`);
    expect(usage).toBe(1);

    // A late status read or callback nudge changes nothing and never charges again.
    await settle(a.render.id);
    const { count: usageAgain } = await admin
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("request_id", `reservation:${row.reservation_id}`);
    expect(usageAgain).toBe(1);

    const view = await getRenderView(alice.db as never, workspaceId, a.render.id);
    expect(view.videoUrl).toMatch(/^https:\/\//);
    const video = await fetch(view.videoUrl!, { method: "HEAD" });
    expect(video.ok).toBe(true);
    expect(video.headers.get("content-type")).toContain("video");
    const download = await renderDownload(alice.db as never, workspaceId, a.render.id);
    expect(download.url).toContain("download=");

    // The Library listing shows it.
    const { data: library } = await alice.db
      .from("assets")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("asset_type", "video");
    expect((library ?? []).map((x: { id: string }) => x.id)).toContain(row.asset_id);
  }, 480_000);

  it("a render the provider rejects fails cleanly and returns the allowance", async () => {
    const { supabaseUgcStore } = await import("@/server/ugc/store.supabase.server");
    const { getPlanLimits } = await import("@/server/plans");
    const limits = getPlanLimits("starter");
    const renderKey = `reject-${randomUUID()}`;
    const hold = await supabaseUgcStore.reserve({
      scopeKey: `ws:${workspaceId}`,
      workspaceId,
      userId: alice.id,
      units: 1,
      estCostUsd: 0.15,
      provider: "kie",
      model: "veo-3-1:veo3_lite",
      route: "live-test",
      sourceId: `${workspaceId}:${renderKey}`,
      ttlSeconds: 3600,
      limits: {
        dailyUsd: limits.dailyUsd,
        monthlyUsd: limits.monthlyUsd,
        monthlyUnits: limits.monthlyVideos,
      },
      maxConcurrent: 5,
    });
    expect(hold.ok).toBe(true);
    // Bypass the service's validation on purpose: Veo 3.1 takes only 9:16 and
    // 16:9, so Kie refuses a 1:1 task at submit. A validation refusal must stay
    // on Kie (never the OpenRouter fallback) and return the allowance.
    const { row } = await supabaseUgcStore.insertRender({
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: projectId,
      created_by: alice.id,
      idempotency_key: renderKey,
      model_key: "veo-3-1-lite",
      provider: "kie",
      provider_model: "veo-3-1",
      provider_variant: "veo3_lite",
      generation_type: "REFERENCE_2_VIDEO",
      duration_sec: 8,
      aspect_ratio: "1:1",
      resolution: "720p",
      audio: true,
      reference_asset_ids: [referenceAssetId],
      script: { hook: "x" },
      settings: {},
      prompt: "A person holds the product and smiles.",
      reservation_id: hold.ok ? hold.id : null,
      est_cost_usd: 0.15,
    });
    const settled = await settle(row.id, 3 * 60_000);
    console.log("[ugc-live] rejected render", {
      status: settled.status,
      error: settled.error_message,
    });
    expect(settled.status).toBe("failed");
    const { data: released } = await admin
      .from("ai_usage_reservations")
      .select("state")
      .eq("id", row.reservation_id!)
      .single();
    expect(released!.state).toBe("released");
  }, 240_000);
});
