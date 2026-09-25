// Live workspace isolation against the REAL Supabase project (reads .env):
// two temporary users and two brands — Brand A "Mellox AI" (mellox.ai) and
// Brand B "Northwind Coffee" — exercised through PostgREST with each user's own
// JWT, so row-level security, storage policies and the migrated functions are
// what is actually tested. Every user, workspace and file it creates is
// removed at the end.
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/workspace-isolation.live.ts
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

type Actor = { id: string; email: string; db: SupabaseClient };

let admin: SupabaseClient;
let alice: Actor; // owns Brand A and Brand B
let bob: Actor; // an unrelated tenant
let brandA: string;
let brandB: string;
const createdUsers: string[] = [];
const createdWorkspaces = new Set<string>();

async function makeActor(tag: string): Promise<Actor> {
  const { createClient } = await import("@supabase/supabase-js");
  const email = `workspace-iso-${tag}-${randomUUID().slice(0, 8)}@example.com`;
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
  return { id: data.user.id, email, db };
}

(configured ? describe : describe.skip)("workspace isolation (live Supabase)", () => {
  beforeAll(async () => {
    const mod = await import("@/integrations/supabase/client.server");
    admin = mod.supabaseAdmin as unknown as SupabaseClient;
    alice = await makeActor("alice");
    bob = await makeActor("bob");

    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const a = await createOrGetWorkspace({
      userId: alice.id,
      name: "Mellox AI",
      websiteUrl: "https://mellox.ai",
      idempotencyKey: randomUUID(),
    });
    const b = await createOrGetWorkspace({
      userId: alice.id,
      name: "Northwind Coffee",
      websiteUrl: "https://northwind-coffee.example.com",
      idempotencyKey: randomUUID(),
    });
    brandA = a.id;
    brandB = b.id;
    createdWorkspaces.add(brandA).add(brandB);
    expect(a.created && b.created).toBe(true);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdWorkspaces) {
      const { data: objects } = await admin.storage
        .from("generated-assets")
        .list(`workspace/${id}/assets`);
      if (objects?.length) {
        await admin.storage
          .from("generated-assets")
          .remove(objects.map((o) => `workspace/${id}/assets/${o.name}`));
      }
      await admin.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  describe("creation and duplicates", () => {
    it("the same brand domain (any spelling) returns the existing workspace", async () => {
      const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
      for (const websiteUrl of [
        "mellox.ai",
        "https://www.MELLOX.ai/",
        "http://mellox.ai/pricing",
      ]) {
        const r = await createOrGetWorkspace({
          userId: alice.id,
          name: "Mellox again",
          websiteUrl,
          idempotencyKey: randomUUID(),
        });
        expect(r).toMatchObject({ id: brandA, created: false, domain: "mellox.ai" });
      }
    });

    it("concurrent creates with one idempotency key (double click, retries, tabs) make one workspace", async () => {
      const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          createOrGetWorkspace({
            userId: alice.id,
            name: "Retry Brand",
            websiteUrl: null,
            idempotencyKey: key,
          }),
        ),
      );
      const ids = new Set(results.map((r) => r.id));
      for (const id of ids) createdWorkspaces.add(id);
      expect(ids.size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
    });

    it("concurrent creates for one new domain without a shared key still make one workspace", async () => {
      const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          createOrGetWorkspace({
            userId: alice.id,
            name: "Race Brand",
            websiteUrl: "https://race-brand.example.com",
            idempotencyKey: randomUUID(),
          }),
        ),
      );
      const ids = new Set(results.map((r) => r.id));
      for (const id of ids) createdWorkspaces.add(id);
      expect(ids.size).toBe(1);
    });

    it("the browser cannot insert a workspace directly", async () => {
      const { error } = await alice.db
        .from("workspaces")
        .insert({ owner_id: alice.id, name: "direct insert" });
      expect(error).not.toBeNull();
    });

    it("an owner cannot change their plan from the browser", async () => {
      const { error } = await alice.db
        .from("workspaces")
        .update({ plan: "enterprise" })
        .eq("id", brandA);
      expect(error?.message ?? "").toMatch(/server-managed|permission/i);
    });
  });

  describe("data isolation between tenants", () => {
    beforeAll(async () => {
      const { writeBrandDna } = await import("@/server/workspaces/brand-dna.server");
      await writeBrandDna({
        workspaceId: brandA,
        userId: alice.id,
        dna: { brandName: "Mellox AI", voice: "precise", audience: "marketing leaders" },
      });
      await writeBrandDna({
        workspaceId: brandB,
        userId: alice.id,
        dna: { brandName: "Northwind Coffee", voice: "cosy", audience: "coffee lovers" },
      });
      const { error } = await alice.db.from("content_items").insert([
        { workspace_id: brandA, title: "A draft 1", status: "draft", created_by: alice.id },
        { workspace_id: brandA, title: "A draft 2", status: "draft", created_by: alice.id },
        { workspace_id: brandB, title: "B draft", status: "draft", created_by: alice.id },
      ]);
      expect(error).toBeNull();
    }, 60_000);

    it("Brand DNA reads back per workspace, never mixed", async () => {
      const { data } = await alice.db
        .from("workspace_brand_dna")
        .select("workspace_id, dna")
        .in("workspace_id", [brandA, brandB]);
      const byId = new Map((data ?? []).map((r) => [r.workspace_id, r.dna]));
      expect(byId.get(brandA)).toMatchObject({ brandName: "Mellox AI", voice: "precise" });
      expect(byId.get(brandB)).toMatchObject({ brandName: "Northwind Coffee", voice: "cosy" });
    });

    it("another tenant sees none of the brands' workspaces, DNA, content or chats", async () => {
      for (const table of ["workspaces", "workspace_brand_dna", "content_items", "conversations"]) {
        const col = table === "workspaces" ? "id" : "workspace_id";
        const { data } = await bob.db.from(table).select("*").in(col, [brandA, brandB]);
        expect(data ?? [], table).toHaveLength(0);
      }
      const { data: overview } = await bob.db.rpc("workspace_overview");
      expect(overview ?? []).toHaveLength(0);
    });

    it("another tenant cannot write into Brand A", async () => {
      const { error } = await bob.db
        .from("content_items")
        .insert({ workspace_id: brandA, title: "intrusion" });
      expect(error).not.toBeNull();
      const { error: chatError } = await bob.db
        .from("conversations")
        .insert({ workspace_id: brandA, title: "intrusion" });
      expect(chatError).not.toBeNull();
    });

    it("a Brand A conversation can't receive messages filed under Brand B", async () => {
      const { data: conv, error } = await alice.db
        .from("conversations")
        .insert({ workspace_id: brandA, title: "Brand A chat" })
        .select("id")
        .single();
      expect(error).toBeNull();
      const { error: crossError } = await alice.db.from("chat_messages").insert({
        workspace_id: brandB,
        conversation_id: conv!.id,
        user_id: alice.id,
        role: "user",
        kind: "text",
        content: "this belongs to Brand A",
      });
      expect(crossError).not.toBeNull();
    });

    it("the workspace overview attributes every count to its own workspace", async () => {
      const { data, error } = await alice.db.rpc("workspace_overview");
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{ id: string; draft_count: number; domain: string }>;
      const a = rows.find((r) => r.id === brandA);
      const b = rows.find((r) => r.id === brandB);
      expect(Number(a?.draft_count)).toBe(2);
      expect(a?.domain).toBe("mellox.ai");
      expect(Number(b?.draft_count)).toBe(1);
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    });

    it("storage: members write their own workspace's path; strangers can't touch it", async () => {
      const path = `workspace/${brandA}/assets/isolation-${randomUUID()}.txt`;
      const body = new Blob(["brand a asset"], { type: "text/plain" });
      const own = await alice.db.storage.from("generated-assets").upload(path, body);
      expect(own.error).toBeNull();
      const foreign = await bob.db.storage
        .from("generated-assets")
        .upload(`workspace/${brandA}/assets/intrusion-${randomUUID()}.txt`, body);
      expect(foreign.error).not.toBeNull();
      const read = await bob.db.storage.from("generated-assets").download(path);
      expect(read.error).not.toBeNull();
    });
  });

  describe("deletion", () => {
    it("requires CONFIRM and the owner", async () => {
      const { deleteWorkspace } = await import("@/server/workspaces/service.server");
      await expect(
        deleteWorkspace({ workspaceId: brandA, userId: alice.id, confirmation: "confirm" }),
      ).rejects.toThrow(/CONFIRM/);
      await expect(
        deleteWorkspace({ workspaceId: brandA, userId: bob.id, confirmation: "CONFIRM" }),
      ).rejects.toThrow(/not found/i);
    });

    it("deleting Brand A removes its data and files and leaves Brand B and the account intact", async () => {
      const { deleteWorkspace } = await import("@/server/workspaces/service.server");
      const result = await deleteWorkspace({
        workspaceId: brandA,
        userId: alice.id,
        confirmation: "CONFIRM",
      });
      createdWorkspaces.delete(brandA);
      expect(result.storageObjectsRemoved).toBeGreaterThanOrEqual(1);

      for (const table of ["content_items", "workspace_brand_dna", "conversations"]) {
        const { data } = await admin.from(table).select("workspace_id").eq("workspace_id", brandA);
        expect(data ?? [], table).toHaveLength(0);
      }
      const { data: files } = await admin.storage
        .from("generated-assets")
        .list(`workspace/${brandA}/assets`);
      expect(files ?? []).toHaveLength(0);

      const { data: bDna } = await alice.db
        .from("workspace_brand_dna")
        .select("dna")
        .eq("workspace_id", brandB)
        .single();
      expect(bDna?.dna).toMatchObject({ brandName: "Northwind Coffee" });
      const { data: bItems } = await alice.db
        .from("content_items")
        .select("id")
        .eq("workspace_id", brandB);
      expect(bItems).toHaveLength(1);
      const { data: user } = await admin.auth.admin.getUserById(alice.id);
      expect(user.user?.id).toBe(alice.id);

      const { data: record } = await admin
        .from("workspace_deletions")
        .select("domain, deleted_by")
        .eq("workspace_id", brandA)
        .single();
      expect(record).toMatchObject({ domain: "mellox.ai", deleted_by: alice.id });
      await admin.from("workspace_deletions").delete().eq("workspace_id", brandA);
    }, 60_000);
  });
});
