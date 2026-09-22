// competitors-db.live.ts — the competitor entity against the REAL Supabase
// project: the migration as it was actually applied, its RLS, its unique
// indexes, its workspace guard and its lease RPC.
//
// It creates two temporary users and two temporary workspaces, exercises the
// store and the background worker through them, and deletes everything at the
// end. It does no web research and spends nothing: the engines are covered by
// competitors.live.ts, and what is under test here is the data layer.
//
//   npx vitest run --config vitest.live.config.ts tests/live/competitors-db.live.ts
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
  !!process.env.SUPABASE_PUBLISHABLE_KEY;

type Actor = { id: string; db: SupabaseClient };

let admin: SupabaseClient;
let owner: Actor;
let outsider: Actor;
let workspaceA: string;
let workspaceB: string;
const createdUsers: string[] = [];
const createdWorkspaces = new Set<string>();

async function makeActor(tag: string): Promise<Actor> {
  const { createClient } = await import("@supabase/supabase-js");
  const email = `competitors-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUsers.push(data.user.id);
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

(configured ? describe : describe.skip)("competitor entity (live Supabase)", () => {
  beforeAll(async () => {
    const mod = await import("@/integrations/supabase/client.server");
    admin = mod.supabaseAdmin as unknown as SupabaseClient;
    owner = await makeActor("owner");
    outsider = await makeActor("outsider");

    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const a = await createOrGetWorkspace({
      userId: owner.id,
      name: "Competitor Test A",
      websiteUrl: `https://competitor-test-a-${randomUUID().slice(0, 8)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    const b = await createOrGetWorkspace({
      userId: owner.id,
      name: "Competitor Test B",
      websiteUrl: `https://competitor-test-b-${randomUUID().slice(0, 8)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    workspaceA = a.id;
    workspaceB = b.id;
    createdWorkspaces.add(workspaceA).add(workspaceB);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdWorkspaces) await admin.from("workspaces").delete().eq("id", id);
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it("creates one row per company, however the same company arrives", async () => {
    const { upsertCompetitor } = await import("@/server/competitors/store.server");

    const first = await upsertCompetitor({
      workspaceId: workspaceA,
      userId: owner.id,
      name: "Rival",
      domain: "rival-example.com",
      url: "https://rival-example.com",
      source: "discovered",
      status: "suggested",
      relationship: "direct",
      confidence: 0.7,
      rationale: "Sells the same thing",
      discoverySources: [{ title: "A comparison", url: "https://news.example.com/compare" }],
    });
    expect(first).not.toBeNull();

    // The same company, spelled differently, arriving by another route.
    const again = await upsertCompetitor({
      workspaceId: workspaceA,
      userId: owner.id,
      name: "Rival Inc",
      domain: "https://WWW.Rival-Example.com/pricing",
      url: null,
      source: "manual",
      status: "tracked",
    });
    expect(again?.id).toBe(first?.id);

    const { data } = await admin
      .from("workspace_competitors")
      .select("id")
      .eq("workspace_id", workspaceA)
      .eq("domain", "rival-example.com");
    expect(data).toHaveLength(1);
  }, 60_000);

  it("never re-opens a decision the user already made", async () => {
    const { upsertCompetitor, setStatus } = await import("@/server/competitors/store.server");
    const created = await upsertCompetitor({
      workspaceId: workspaceA,
      userId: owner.id,
      name: "Ignored Co",
      domain: "ignored-example.com",
      url: null,
      source: "discovered",
      status: "suggested",
    });
    await setStatus({
      workspaceId: workspaceA,
      competitorId: created!.id,
      status: "ignored",
    });

    // Discovery finds it again next week: it must stay ignored.
    const rediscovered = await upsertCompetitor({
      workspaceId: workspaceA,
      userId: owner.id,
      name: "Ignored Co",
      domain: "ignored-example.com",
      url: null,
      source: "discovered",
      status: "suggested",
    });
    expect(rediscovered?.status).toBe("ignored");
  }, 60_000);

  it("only claims tracked competitors that are actually due", async () => {
    const { upsertCompetitor } = await import("@/server/competitors/store.server");
    const tracked = await upsertCompetitor({
      workspaceId: workspaceA,
      userId: owner.id,
      name: "Due Co",
      domain: "due-example.com",
      url: null,
      source: "manual",
      status: "tracked",
    });
    await upsertCompetitor({
      workspaceId: workspaceA,
      userId: owner.id,
      name: "Suggested Co",
      domain: "suggested-example.com",
      url: null,
      source: "discovered",
      status: "suggested",
    });

    const { data, error } = await admin.rpc("claim_competitor_jobs", {
      p_worker: "live-test",
      p_max: 10,
      p_lease_seconds: 60,
      p_competitor_id: tracked!.id,
    });
    expect(error).toBeNull();
    const claimed = (data ?? []) as { id: string; domain: string; locked_by: string }[];
    expect(claimed.map((row) => row.id)).toEqual([tracked!.id]);
    expect(claimed[0].locked_by).toBe("live-test");

    // A held lease is not claimable by a second worker.
    const { data: again } = await admin.rpc("claim_competitor_jobs", {
      p_worker: "live-test-2",
      p_max: 10,
      p_lease_seconds: 60,
      p_competitor_id: tracked!.id,
    });
    expect((again ?? []) as unknown[]).toHaveLength(0);

    // Release, so the row does not sit leased for the rest of the run.
    await admin
      .from("workspace_competitors")
      .update({ lease_until: null, locked_by: null })
      .eq("id", tracked!.id);
  }, 60_000);

  it("stores one update per real change and refuses a duplicate", async () => {
    const { upsertCompetitor } = await import("@/server/competitors/store.server");
    const competitor = await upsertCompetitor({
      workspaceId: workspaceA,
      userId: owner.id,
      name: "Newsy Co",
      domain: "newsy-example.com",
      url: null,
      source: "manual",
      status: "tracked",
    });

    const row = {
      workspace_id: workspaceA,
      competitor_id: competitor!.id,
      kind: "launch",
      title: "Newsy launches a new plan",
      summary: "They added a cheaper tier.",
      significance: "major",
      source_url: "https://news.example.com/newsy-launch",
      source_title: "Newsy launches",
      fingerprint: "https://news.example.com/newsy-launch|newsy launches a new plan",
    };

    const first = await admin
      .from("competitor_updates")
      .upsert([row], { onConflict: "competitor_id,fingerprint", ignoreDuplicates: true })
      .select("id");
    expect(first.error).toBeNull();

    const second = await admin
      .from("competitor_updates")
      .upsert([row], { onConflict: "competitor_id,fingerprint", ignoreDuplicates: true })
      .select("id");
    expect(second.error).toBeNull();

    const { data } = await admin
      .from("competitor_updates")
      .select("id")
      .eq("competitor_id", competitor!.id);
    expect(data).toHaveLength(1);
  }, 60_000);

  it("refuses to attach an update to another workspace's competitor", async () => {
    const { upsertCompetitor } = await import("@/server/competitors/store.server");
    const competitor = await upsertCompetitor({
      workspaceId: workspaceB,
      userId: owner.id,
      name: "Other Workspace Co",
      domain: "otherws-example.com",
      url: null,
      source: "manual",
      status: "tracked",
    });

    // Workspace A claiming a competitor that belongs to workspace B must fail
    // in the database, not merely in application code.
    const { error } = await admin.from("competitor_updates").insert({
      workspace_id: workspaceA,
      competitor_id: competitor!.id,
      kind: "content",
      title: "Cross tenant",
      significance: "notable",
      fingerprint: `cross-${randomUUID()}`,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/does not belong to workspace/i);
  }, 60_000);

  it("lets a member read its own competitors and no one else's", async () => {
    const { loadOverview } = await import("@/server/competitors/store.server");

    const mine = await loadOverview(owner.db as never, workspaceA);
    expect(mine.competitors.length).toBeGreaterThan(0);
    for (const competitor of [...mine.competitors, ...mine.suggestions]) {
      expect(competitor.workspaceId).toBe(workspaceA);
    }

    // An outsider's RLS-bound client sees nothing at all.
    const { data } = await outsider.db
      .from("workspace_competitors")
      .select("id")
      .eq("workspace_id", workspaceA);
    expect(data ?? []).toHaveLength(0);

    const { data: updates } = await outsider.db
      .from("competitor_updates")
      .select("id")
      .eq("workspace_id", workspaceA);
    expect(updates ?? []).toHaveLength(0);
  }, 60_000);

  it("refuses a browser write even from a member", async () => {
    const { error } = await owner.db.from("workspace_competitors").insert({
      workspace_id: workspaceA,
      name: "Sneaky",
      domain: "sneaky-example.com",
    });
    expect(error).not.toBeNull();
  }, 60_000);

  it("removes a workspace's competitors and updates with the workspace", async () => {
    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const { upsertCompetitor } = await import("@/server/competitors/store.server");
    const temp = await createOrGetWorkspace({
      userId: owner.id,
      name: "Cascade Test",
      websiteUrl: `https://cascade-${randomUUID().slice(0, 8)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    const competitor = await upsertCompetitor({
      workspaceId: temp.id,
      userId: owner.id,
      name: "Cascade Co",
      domain: "cascade-example.com",
      url: null,
      source: "manual",
      status: "tracked",
    });
    await admin.from("competitor_updates").insert({
      workspace_id: temp.id,
      competitor_id: competitor!.id,
      kind: "content",
      title: "Something",
      significance: "notable",
      fingerprint: `cascade-${randomUUID()}`,
    });

    await admin.from("workspaces").delete().eq("id", temp.id);

    const { data: left } = await admin
      .from("workspace_competitors")
      .select("id")
      .eq("id", competitor!.id);
    expect(left ?? []).toHaveLength(0);
    const { data: leftUpdates } = await admin
      .from("competitor_updates")
      .select("id")
      .eq("competitor_id", competitor!.id);
    expect(leftUpdates ?? []).toHaveLength(0);
  }, 120_000);
});
