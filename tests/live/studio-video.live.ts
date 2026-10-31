// Live check of the Studio video system (ADR-0041): what mocks can't show.
//
//   npx vitest run --config vitest.live.config.ts tests/live/studio-video.live.ts
//
// Free, needs FFmpeg: a post picture framed for a 9:16 video keeps the whole
// post, and the "end on the post" step makes a video of the planned length
// that really finishes on the picture.
//
// Spends (one Opus storyboard call), only with STUDIO_VIDEO_LIVE=yes: the
// real model writes a storyboard for a two-clip product showcase that passes
// every pure check, and each clip's prompt carries the whole bible.
//
// Rendering and checking a real video needs a workspace and a provider
// render; drive that in the app (Studio → Video) and read the job's
// `output.videoPlan.check`.
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the paid test skips below.
}

async function testPicture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 40, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"]).status === 0;

describe("studio video finishing (FFmpeg, free)", () => {
  it("frames a square post whole inside a 9:16 video frame", async () => {
    const { frameForVideo } = await import("@/server/studio/video/finish.server");
    const framed = await frameForVideo(await testPicture(1080, 1080), "9:16");
    const meta = await sharp(framed).metadata();
    expect(meta.width! / meta.height!).toBeCloseTo(9 / 16, 2);
    // The centre is the post's own colour, not a crop of something else.
    const { data } = await sharp(framed)
      .extract({
        left: Math.floor(meta.width! / 2),
        top: Math.floor(meta.height! / 2),
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(180);
  }, 60_000);

  it.runIf(hasFfmpeg)(
    "ends a video on the exact picture without losing its length",
    async () => {
      const { endOnStill, probeVideo } = await import("@/server/studio/video/finish.server");
      const { execFile } = await import("node:child_process");
      const { mkdtemp, readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const dir = await mkdtemp(join(tmpdir(), "mellox-video-live-"));
      const out = join(dir, "clip.mp4");
      await new Promise<void>((resolve, reject) =>
        execFile(
          ffmpeg,
          [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=720x1280:rate=24:duration=4",
            "-pix_fmt",
            "yuv420p",
            out,
          ],
          (error) => (error ? reject(error) : resolve()),
        ),
      );
      const dataUrl = `data:video/mp4;base64,${(await readFile(out)).toString("base64")}`;
      const ended = await endOnStill(dataUrl, await testPicture(720, 1280), {
        duration: 4,
        width: 720,
        height: 1280,
        audio: false,
      });
      const probe = await probeVideo(ended);
      expect(probe.duration).toBeGreaterThan(4.5);
      expect(probe.duration).toBeLessThan(6.5);
    },
    120_000,
  );
});

const paid =
  process.env.STUDIO_VIDEO_LIVE === "yes" && !!process.env.OPENROUTER_API_KEY
    ? describe
    : describe.skip;

paid("studio video storyboard (live model)", () => {
  it("writes a complete, consistent two-clip product showcase", async () => {
    const [{ buildVideoStoryboardPrompt, emptyContext, ANGLES }, { runStructuredPrompt }, video] =
      await Promise.all([
        import("@/lib/studio/prompts"),
        import("@/lib/ai/run.server"),
        Promise.all([
          import("@/lib/studio/video/lengths"),
          import("@/lib/studio/video/storyboard"),
        ]),
      ]);
    const [{ clipPlan }, { fitStoryboard, storyboardIssues, clipPrompt }] = video;
    const plan = clipPlan(16, "standard");
    const built = buildVideoStoryboardPrompt({
      ctx: emptyContext("Northwind Coffee"),
      intent: { brief: "Show off our new oat-milk cold brew can: crisp, cold, made for summer." },
      controls: { platforms: ["instagram"], durationSec: 16, videoKind: "product-showcase" },
      angle: ANGLES[0],
      video: { kind: "product-showcase", plan, fromPicture: false },
    });
    const result = await runStructuredPrompt({ ...built, maxTokens: built.maxTokens ?? 6000 });
    const storyboard = fitStoryboard(result.storyboard, plan);
    expect(storyboard.clips).toHaveLength(plan.length);
    expect(
      storyboardIssues(storyboard, { kind: "product-showcase", plan, knownFacts: "" }),
    ).toEqual([]);
    for (let i = 0; i < plan.length; i++) {
      const prompt = clipPrompt(storyboard, i, {
        kind: "product-showcase",
        plan,
        brandName: "Northwind Coffee",
        ratio: "9:16",
        chained: true,
        fromPicture: false,
        productPhoto: false,
        audio: true,
      });
      expect(prompt).toContain(storyboard.bible.setting);
    }
  }, 180_000);
});
