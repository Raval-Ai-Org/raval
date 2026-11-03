// Live check of Inspo's direct uploads through a RUNNING dev server, the real
// Supabase project and the real storage (R2 when configured; reads .env). A
// temporary user and brand do what the browser does: /start for signed
// links, a PUT straight to storage, /finish to save. No AI spend.
//
// Always: a photo becomes one reference and its raw upload is removed; a file
// that never arrived and a wrong type each get a plain reason; a stranger
// can't finish someone else's upload; storage answers the browser's CORS check.
// With FFmpeg (on PATH or FFMPEG_PATH, the same one the server uses): a
// two-scene video is saved with one still per scene, all linked to it.
//
// Needs the app running (default http://localhost:8080, or LIVE_APP_URL).
// Everything it creates is deleted, stored files included.
//   npx vitest run --config vitest.live.config.ts tests/live/inspo-upload.live.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UPLOAD_MESSAGES } from "@/lib/inspo/uploads";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}
try {
  process.loadEnvFile(".env.local");
} catch {
  // Optional.
}

const BASE = (process.env.LIVE_APP_URL ?? "http://localhost:8080").replace(/\/$/, "");
const configured =
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SUPABASE_PUBLISHABLE_KEY;
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

type Actor = { id: string; token: string };
type Started = {
  id?: string;
  name: string;
  type?: string;
  size?: number;
  error?: string;
  upload?: { url: string; method: "PUT"; headers: Record<string, string> };
};

let admin: SupabaseClient;
let owner: Actor;
let stranger: Actor;
let workspaceId = "";
let reachable = false;
const createdUsers: string[] = [];

async function makeActor(tag: string): Promise<Actor> {
  const { createClient } = await import("@supabase/supabase-js");
  const email = `inspo-upload-${tag}-${randomUUID().slice(0, 8)}@example.com`;
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
  return { id: data.user.id, token: session.session.access_token };
}

async function post<T>(actor: Actor, path: string, body: unknown) {
  const res = await fetch(`${BASE}/api/brand-visuals/${path}?workspaceId=${workspaceId}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${actor.token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

async function put(item: Started, bytes: Buffer) {
  const res = await fetch(item.upload!.url, {
    method: "PUT",
    headers: item.upload!.headers,
    body: new Uint8Array(bytes),
  });
  expect(res.status, await res.text().catch(() => "")).toBeLessThan(300);
}

const info = (item: Started) => ({
  id: item.id!,
  name: item.name,
  type: item.type!,
  size: item.size!,
});

(configured ? describe : describe.skip)("Inspo direct uploads (live)", () => {
  beforeAll(async () => {
    reachable = await fetch(`${BASE}/api/health`)
      .then(() => true)
      .catch(() => false);
    if (!reachable) return;
    const mod = await import("@/integrations/supabase/client.server");
    admin = mod.supabaseAdmin as unknown as SupabaseClient;
    owner = await makeActor("owner");
    stranger = await makeActor("stranger");
    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const ws = await createOrGetWorkspace({
      userId: owner.id,
      name: "Inspo Upload Live",
      websiteUrl: `https://inspo-upload-${randomUUID().slice(0, 8)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    workspaceId = ws.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    if (workspaceId) {
      const storage = await import("@/server/assets/storage.server");
      const { data: rows } = await admin
        .from("assets")
        .select("storage_path")
        .eq("workspace_id", workspaceId);
      const paths = new Set(
        (rows ?? []).flatMap((r) =>
          r.storage_path
            ? [r.storage_path, r.storage_path.replace(/\/[^/]+$/, "/preview.jpg")]
            : [],
        ),
      );
      if (storage.isR2StorageEnabled())
        for (const p of await storage.listR2WorkspaceAssetPaths(workspaceId)) paths.add(p);
      if (paths.size) await storage.removeAssetObjects([...paths]).catch(() => {});
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it("saves a photo, and explains a missing file and a wrong type", async (ctx) => {
    if (!reachable) return ctx.skip();
    const png = await sharp({
      create: { width: 320, height: 200, channels: 3, background: "#7ac143" },
    })
      .png()
      .toBuffer();
    const start = await post<{ items: Started[] }>(owner, "upload/start", {
      files: [
        { name: "Moss.png", type: "image/png", size: png.length },
        { name: "Never sent.png", type: "image/png", size: png.length },
        { name: "anim.gif", type: "image/gif", size: 100 },
      ],
    });
    expect(start.status).toBe(200);
    const [photo, missing, gif] = start.json.items;
    expect(photo.id && missing.id).toBeTruthy();
    expect(gif.error).toBe(UPLOAD_MESSAGES.type);
    await put(photo, png);

    // A stranger can't save this brand's uploads.
    const denied = await post(stranger, "upload/finish", {
      purpose: "style",
      items: [info(photo)],
    });
    expect([403, 404]).toContain(denied.status);

    const finish = await post<{ results: { id: string; assetId?: string; error?: string }[] }>(
      owner,
      "upload/finish",
      { purpose: "style", items: [info(photo), info(missing)] },
    );
    expect(finish.status).toBe(200);
    const saved = finish.json.results.find((r) => r.id === photo.id);
    expect(saved?.assetId, saved?.error).toBeTruthy();
    expect(finish.json.results.find((r) => r.id === missing.id)?.error).toBe(
      UPLOAD_MESSAGES.missing,
    );

    const { data: source } = await admin
      .from("brand_visual_sources")
      .select("label,purpose,kind")
      .eq("workspace_id", workspaceId)
      .eq("asset_id", saved!.assetId!)
      .single();
    expect(source).toMatchObject({ label: "Moss", purpose: "style", kind: "upload" });

    // The raw upload was only a waiting place; the photo is kept as its own PNG.
    const storage = await import("@/server/assets/storage.server");
    const { inboxPath } = await import("@/server/brand-visuals/ingest.server");
    expect(
      await storage.assetObjectSize(inboxPath(workspaceId, photo.id!, "image/png")),
    ).toBeNull();
  }, 180_000);

  it("lets the app's page PUT straight to storage (CORS)", async (ctx) => {
    if (!reachable) return ctx.skip();
    const start = await post<{ items: Started[] }>(owner, "upload/start", {
      files: [{ name: "cors.png", type: "image/png", size: 10 }],
    });
    const url = start.json.items[0].upload!.url;
    const res = await fetch(url, {
      method: "OPTIONS",
      headers: {
        origin: BASE,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });
    const allowed = res.headers.get("access-control-allow-origin");
    expect(
      allowed === "*" || allowed === BASE,
      `storage answered ${res.status}, allow-origin ${allowed ?? "none"}: add a CORS rule for ${BASE}`,
    ).toBe(true);
  }, 60_000);

  (hasFfmpeg ? it : it.skip)(
    "saves a two-scene video with one still per scene",
    async (ctx) => {
      if (!reachable) return ctx.skip();
      const dir = mkdtempSync(join(tmpdir(), "inspo-live-"));
      try {
        const file = join(dir, "clip.mp4");
        execFileSync(
          FFMPEG,
          [
            ...["-hide_banner", "-loglevel", "error", "-y"],
            ...["-f", "lavfi", "-i", "color=c=0x7ac143:s=320x568:d=2:r=30"],
            ...["-f", "lavfi", "-i", "color=c=0x1d3fbb:s=320x568:d=2:r=30"],
            ...["-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]"],
            ...["-c:v", "libx264", "-pix_fmt", "yuv420p", file],
          ],
          { windowsHide: true },
        );
        const mp4 = readFileSync(file);
        const start = await post<{ items: Started[] }>(owner, "upload/start", {
          files: [{ name: "Two scenes.mp4", type: "video/mp4", size: mp4.length }],
        });
        const [video] = start.json.items;
        expect(video.id, video.error).toBeTruthy();
        await put(video, mp4);
        const finish = await post<{ results: { id: string; assetId?: string; error?: string }[] }>(
          owner,
          "upload/finish",
          { purpose: "style", items: [info(video)] },
        );
        const saved = finish.json.results[0];
        expect(saved.assetId, saved.error).toBe(video.id);

        const { data: asset } = await admin
          .from("assets")
          .select("asset_type,storage_path,width,height,metadata")
          .eq("id", video.id!)
          .single();
        expect(asset).toMatchObject({ asset_type: "video", width: 320, height: 568 });
        expect((asset!.metadata as { scenes?: number }).scenes).toBe(2);

        const { data: frames } = await admin
          .from("assets")
          .select("id,metadata")
          .eq("workspace_id", workspaceId)
          .eq("parent_asset_id", video.id!);
        expect(frames?.length).toBe(2);
        const { data: sources } = await admin
          .from("brand_visual_sources")
          .select("asset_id,label")
          .eq("workspace_id", workspaceId)
          .in("asset_id", [video.id!, ...frames!.map((f) => f.id)]);
        expect(sources?.length).toBe(3);
        expect(sources!.filter((s) => / · \d+\.\ds$/.test(s.label))).toHaveLength(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    300_000,
  );
});
