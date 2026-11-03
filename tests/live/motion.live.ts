// Live check of motion graphics (src/lib/studio/motion/, src/server/studio/motion/)
// against the real Supabase project (reads .env) and real Chromium.
//
// It picks the workspace with the fullest Brand DNA, loads its look, and asks
// the real model (route studio.motion.compose, Opus; a few tens of cents) for
// one 8 s motion graphic, then checks it was grounded, passed the drawn checks
// and became an H.264 MP4. Spends only behind MOTION_LIVE_AI=yes. The drawing
// needs FFmpeg on PATH (or FFMPEG_PATH).
//   MOTION_LIVE_AI=yes npx vitest run --config vitest.live.config.ts tests/live/motion.live.ts
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive =
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.MOTION_LIVE_AI === "yes"
    ? describe
    : describe.skip;

describeLive("motion graphics (live)", () => {
  it("designs, checks and draws one 8 s motion graphic for a real brand", async () => {
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
    const facts = JSON.stringify(best.dna).slice(0, 6000);

    const { makeMotionGraphic } = await import("@/server/studio/motion/compose.server");
    const started = Date.now();
    const result = await makeMotionGraphic({
      workspaceId: best.id,
      brief: `A short brand moment for ${brandName}: what they do, and a call to visit.`,
      seconds: 8,
      ratio: "9:16",
      brandText: `Brand: ${brandName}`,
      brandName,
      knownFacts: facts,
      seed: 1,
    });
    console.log(
      JSON.stringify({
        ok: result.ok,
        attempts: result.attempts,
        ms: Date.now() - started,
        ...(result.ok
          ? { layout: result.layout, copy: result.doc.copy, bytes: result.video.length }
          : { reason: result.reason, issues: result.issues }),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // An MP4 starts with an ftyp box.
    expect(result.video.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(result.samples.length).toBeGreaterThan(3);
  }, 600_000);
});
