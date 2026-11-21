// Live check of MotionMox (ADR-0045) on the real "Brand my clips" path:
// renderClipEdit against the real Supabase project (reads .env), real storage,
// real Chromium and the real end-card design call.
//
// It stores one generated 4 s clip (with sound) in the workspace with the
// fullest Brand DNA, runs a brand edit asking for a headline, a price tag, a
// button and a progress bar, and checks the video was drawn by MotionMox (not
// the FFmpeg fallback), kept its sound and is an H.264 MP4. Everything it
// stored is removed afterwards. The end card is one image-model call (a few
// cents), so it runs only behind MOTIONMOX_LIVE_AI=yes, with a built bundle
// (npm run motionmox:bundle) and a full FFmpeg on PATH or FFMPEG_PATH /
// FFPROBE_PATH (the compositor's own small build lacks pad, xfade, overlay).
//   MOTIONMOX_LIVE_AI=yes npx vitest run --config vitest.live.config.ts tests/live/motionmox.live.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive =
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.MOTIONMOX_LIVE_AI === "yes"
    ? describe
    : describe.skip;

const bin = join(
  process.cwd(),
  "node_modules",
  "@motionmox",
  process.platform === "win32" ? "compositor-win32-x64-msvc" : "compositor-linux-x64-gnu",
);
const exe = (name: string) => join(bin, process.platform === "win32" ? `${name}.exe` : name);

describeLive("MotionMox on Brand my clips (live)", () => {
  const dir = mkdtempSync(join(process.env.MOTIONMOX_TMP || tmpdir(), "motionmox-live-"));
  const assetIds: string[] = [];
  const paths: string[] = [];

  afterAll(async () => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { removeAssetObjects } = await import("@/server/assets/storage.server");
    if (paths.length) await removeAssetObjects(paths).catch(() => undefined);
    if (assetIds.length) await db.from("assets").delete().in("id", assetIds);
    rmSync(dir, { recursive: true, force: true });
  });

  it("animates the asked-for elements into a real clip and stores the video", async () => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await db
      .from("workspace_brand_dna")
      .select("workspace_id, dna")
      .limit(200);
    const best = (rows ?? [])
      .map((r) => ({ id: r.workspace_id as string, dna: (r.dna ?? {}) as Record<string, unknown> }))
      .sort((a, b) => JSON.stringify(b.dna).length - JSON.stringify(a.dna).length)[0];
    expect(best, "a workspace with Brand DNA").toBeTruthy();
    const brandName = String(best.dna.brandName ?? best.dna.name ?? "The brand");

    // A looped picture with a tone (the compositor's FFmpeg has no test pattern).
    await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#3366cc" } })
      .png()
      .toFile(join(dir, "frame.png"));
    const clip = join(dir, "clip.mp4");
    execFileSync(exe("ffmpeg"), [
      ...["-y", "-loop", "1", "-framerate", "30", "-t", "4", "-i", join(dir, "frame.png")],
      ...["-f", "lavfi", "-i", "sine=frequency=440:duration=4"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip],
    ]);

    const { persistAsset } = await import("@/server/assets/persist.server");
    const runId = crypto.randomUUID();
    const source = await persistAsset({
      workspaceId: best.id,
      idempotencyKey: `motionmox-live:${runId}:source`,
      bytes: readFileSync(clip),
      preserveBytes: true,
      mimeType: "video/mp4",
      assetType: "video",
      filename: "motionmox-live-source",
      metadata: { source: "motionmox_live_test" },
    });
    expect(source.ok, source.ok ? "" : source.message).toBe(true);
    if (!source.ok) return;
    assetIds.push(source.asset.id);
    if (source.asset.storage_path) paths.push(source.asset.storage_path);

    const { renderClipEdit } = await import("@/server/studio/clip-edit/render.server");
    const started = Date.now();
    const result = await renderClipEdit({
      client: db as never,
      workspaceId: best.id,
      jobId: runId,
      taskId: `motionmox-live-${runId}`,
      contentItemIds: [],
      task: {
        mode: "brand",
        clipAssetIds: [source.asset.id],
        photoAssetIds: [],
        ratio: "9:16",
        brief: "add a price tag and end with 'Book now'",
        copy: [
          { label: "Headline", text: `New at ${brandName}` },
          { label: "Support line", text: "From Rs 2,500" },
        ],
        endCopy: [{ label: "CTA", text: "Book now" }],
        brand: { brandName, colours: ["#0b3d2e", "#f4c430", "#ffffff"], fonts: [] },
        emphasisSeed: runId,
        captions: false,
        motionElements: ["headline", "price-tag", "cta", "progress-bar"],
      },
    });
    console.log(JSON.stringify({ ms: Date.now() - started, result }));
    expect(result.state).toBe("done");
    if (result.state !== "done") return;
    assetIds.push(result.assetId);
    paths.push(result.storagePath);

    const { data: saved } = await db
      .from("assets")
      .select("metadata, mime_type, workspace_id")
      .eq("id", result.assetId)
      .single();
    const meta = (saved?.metadata ?? {}) as Record<string, unknown>;
    expect(saved?.workspace_id).toBe(best.id);
    expect(saved?.mime_type).toBe("video/mp4");
    // Drawn by MotionMox, not the FFmpeg fallback.
    expect(meta.renderer).toBe("motionmox");
    expect(meta.motion_elements).toEqual(["headline", "price-tag", "cta", "progress-bar"]);

    const { downloadAssetObject } = await import("@/server/assets/storage.server");
    const file = await downloadAssetObject(db as never, result.storagePath);
    expect(file.error).toBeFalsy();
    const out = join(dir, "out.mp4");
    writeFileSync(out, Buffer.from(await file.data!.arrayBuffer()));
    const probe = JSON.parse(
      execFileSync(exe("ffprobe"), ["-v", "error", "-show_streams", "-of", "json", out], {
        encoding: "utf8",
      }),
    );
    const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    expect(video.codec_name).toBe("h264");
    expect(video.width).toBe(720);
    expect(video.height).toBe(1280);
    expect(audio, "the clip's sound is kept").toBeTruthy();
  }, 900_000);
});
