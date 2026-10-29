import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brandVideo, fitClip, grabFrame, joinClips, probeVideo, stillClip } from "./ffmpeg.server";

const encoder = process.env.FFMPEG_PATH || "ffmpeg";
const available =
  spawnSync(encoder, ["-version"], { windowsHide: true, timeout: 5000 }).status === 0;
const run = promisify(execFile);

describe.skipIf(!available)("branding the brand's own clips", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mellox-clip-test-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("fits, joins and brands clips, keeping the length and adding the end card", async () => {
    const source = join(dir, "source.mp4");
    await run(encoder, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      source,
    ]);
    const probe = await probeVideo(source);
    expect(probe).toMatchObject({ width: 320, height: 240, hasAudio: true });

    const fitted = join(dir, "fitted.mp4");
    await fitClip({
      input: source,
      output: fitted,
      width: 360,
      height: 640,
      start: 0,
      seconds: 2,
      hasAudio: true,
    });
    const card = join(dir, "card.png");
    await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#224488" } })
      .png()
      .toFile(card);
    const end = join(dir, "end.mp4");
    await stillClip({ image: card, output: end, width: 360, height: 640, seconds: 1 });
    const joined = join(dir, "joined.mp4");
    await joinClips(dir, [fitted, end], joined);

    const overlay = join(dir, "overlay.png");
    await sharp({
      create: {
        width: 360,
        height: 640,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="360" height="640"><rect y="560" width="360" height="80" fill="#ff0000"/></svg>',
          ),
        },
      ])
      .png()
      .toFile(overlay);
    const finished = join(dir, "finished.mp4");
    await brandVideo({ input: joined, output: finished, overlay, logo: null });

    const out = await probeVideo(finished);
    expect(out).toMatchObject({ width: 360, height: 640, hasAudio: true });
    expect(out.duration).toBeGreaterThan(2.8);
    expect(out.duration).toBeLessThan(3.4);
    // The opening design shows in the first seconds, the footage above it.
    const frame = await sharp(await grabFrame(finished, 1, join(dir, "frame.png")))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (600 * frame.info.width + 180) * frame.info.channels;
    expect(frame.data[at]).toBeGreaterThan(180);
    expect(frame.data[at + 1]).toBeLessThan(80);
    await writeFile(join(dir, "done"), "");
  }, 120_000);
});
