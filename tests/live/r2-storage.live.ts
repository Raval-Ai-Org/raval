// R2 media integration against the configured Cloudflare bucket and Supabase project.
// Creates temporary users, a workspace, one generated image, and one legacy Supabase
// object; all are removed after the test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const configured =
  !!process.env.R2_ACCOUNT_ID &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY &&
  !!process.env.R2_BUCKET_NAME &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SUPABASE_PUBLISHABLE_KEY;

type Actor = { id: string; token: string; db: SupabaseClient };

let admin: SupabaseClient;
let alice: Actor;
let bob: Actor;
let workspaceId: string;
let assetId: string | null = null;
let r2Path: string | null = null;
let legacyPath: string | null = null;
let removeAssetObjects: typeof import("@/server/assets/storage.server").removeAssetObjects;

async function makeActor(tag: string): Promise<Actor> {
  const { createClient } = await import("@supabase/supabase-js");
  const email = `r2-media-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`Could not create temporary R2 test user: ${error?.message}`);
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`Could not sign in temporary R2 test user: ${signInError?.message}`);
  }
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  return { id: data.user.id, token: session.session.access_token, db };
}

async function signRequest(actor: Actor, paths: string[]) {
  const { POST } = await import("@/app/api/assets/sign/route");
  return POST(
    new Request("http://localhost/api/assets/sign", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspaceId, paths }),
    }),
  );
}

(configured ? describe : describe.skip)("Cloudflare R2 asset storage (live)", () => {
  beforeAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    ({ removeAssetObjects } = await import("@/server/assets/storage.server"));
    admin = supabaseAdmin as unknown as SupabaseClient;
    alice = await makeActor("owner");
    bob = await makeActor("outsider");
    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const workspace = await createOrGetWorkspace({
      userId: alice.id,
      name: "Temporary R2 Storage Test",
      websiteUrl: `https://r2-${randomUUID().slice(0, 12)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    workspaceId = workspace.id;
  }, 120_000);

  afterAll(async () => {
    const failures: string[] = [];
    const cleanup = async (task: () => Promise<unknown>, name: string) => {
      try {
        await task();
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : "cleanup failed"}`);
      }
    };
    if (admin && (r2Path || legacyPath)) {
      await cleanup(
        () =>
          removeAssetObjects([r2Path, legacyPath].filter((path): path is string => Boolean(path))),
        "storage objects",
      );
    }
    if (admin && assetId) {
      await cleanup(async () => {
        const { error } = await admin.from("assets").delete().eq("id", assetId);
        if (error) throw new Error(error.message);
      }, "asset row");
    }
    if (admin && workspaceId) {
      await cleanup(async () => {
        const { error } = await admin.from("workspaces").delete().eq("id", workspaceId);
        if (error) throw new Error(error.message);
      }, "workspace");
    }
    if (admin && alice?.id) {
      await cleanup(() => admin.auth.admin.deleteUser(alice.id), "owner user");
    }
    if (admin && bob?.id) {
      await cleanup(() => admin.auth.admin.deleteUser(bob.id), "outsider user");
    }
    if (failures.length) throw new Error(`R2 test cleanup failed: ${failures.join("; ")}`);
  }, 120_000);

  it("persists, signs, streams, authorizes, and deletes generated media while retaining Supabase reads", async () => {
    const { persistAsset } = await import("@/server/assets/persist.server");
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=";
    const persisted = await persistAsset({
      workspaceId,
      idempotencyKey: `r2-live-${randomUUID()}`,
      dataUrl: png,
      assetType: "image",
      mimeType: "image/png",
      filename: "r2-live-check.png",
      provider: "live-test",
    });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error(persisted.message);
    assetId = persisted.asset.id;
    r2Path = persisted.asset.storage_path;
    expect(r2Path).toMatch(/^workspace\/[0-9a-f-]+\/assets\/r2\//i);
    const { listR2WorkspaceAssetPaths } = await import("@/server/assets/storage.server");
    expect(await listR2WorkspaceAssetPaths(workspaceId)).toContain(r2Path);

    const authorized = await signRequest(alice, [r2Path]);
    expect(authorized.status).toBe(200);
    const { urls } = (await authorized.json()) as {
      urls: Array<{ path: string; url: string }>;
    };
    const signedUrl = urls.find((entry) => entry.path === r2Path)?.url;
    expect(signedUrl).toBeTruthy();

    const full = await fetch(signedUrl!);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toContain("image/png");
    expect((await full.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const range = await fetch(signedUrl!, { headers: { Range: "bytes=0-7" } });
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(8);

    const libraryRoute = await import("@/app/api/assets/library/route");
    const libraryResponse = await libraryRoute.GET(
      new Request(
        `http://localhost/api/assets/library?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: { Authorization: `Bearer ${alice.token}` } },
      ),
    );
    expect(libraryResponse.status).toBe(200);
    const library = (await libraryResponse.json()) as {
      assets: Array<{ id: string; url: string | null }>;
    };
    expect(library.assets.find((asset) => asset.id === assetId)?.url).toBeTruthy();

    const denied = await signRequest(bob, [r2Path]);
    expect(denied.status).toBe(403);

    legacyPath = `workspace/${workspaceId}/assets/legacy-${randomUUID()}.txt`;
    const legacyBody = new Blob(["legacy Supabase asset"], { type: "text/plain" });
    const legacyUpload = await alice.db.storage
      .from("generated-assets")
      .upload(legacyPath, legacyBody, { contentType: "text/plain" });
    expect(legacyUpload.error).toBeNull();
    const legacySignResponse = await signRequest(alice, [legacyPath]);
    expect(legacySignResponse.status).toBe(200);
    const legacyPayload = (await legacySignResponse.json()) as {
      urls: Array<{ path: string; url: string }>;
    };
    const legacyUrl = legacyPayload.urls.find((entry) => entry.path === legacyPath)?.url;
    expect(legacyUrl).toBeTruthy();
    const legacyRead = await fetch(legacyUrl!);
    expect(legacyRead.status).toBe(200);
    expect(await legacyRead.text()).toBe("legacy Supabase asset");

    await removeAssetObjects([r2Path]);
    r2Path = null;
    const deletedRead = await fetch(signedUrl!);
    expect([403, 404]).toContain(deletedRead.status);
  }, 120_000);
});
