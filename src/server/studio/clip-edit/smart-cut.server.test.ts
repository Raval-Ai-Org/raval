import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { planClips } from "@/lib/studio/clip-edit";
import { buildCues, captionBox, captionColours } from "@/lib/studio/captions";

// Set CAPTION_SMOKE_OUT=<dir> to fetch a real brand font and write a
// captioned frame to disk for a visual check. Without it the test never
// touches the network and the renderer uses its built-in face.
const OUT = process.env.CAPTION_SMOKE_OUT;
if (!OUT) {
  vi.doMock("@/server/safe-fetch", () => ({
    safeFetch: async () => ({ ok: false, status: 503, bytes: new Uint8Array(0), text: () => "" }),
  }));
}

const {
  analyzeClip,
  audioSilences,
  brandVideo,
  extractAudio,
  fitClip,
  grabFrame,
  joinWithTransitions,
  probeVideo,
  writeCaptionTrack,
} = await import("./ffmpeg.server");
const { renderCaptionImages } = await import("./captions.server");

const encoder = process.env.FFMPEG_PATH || "ffmpeg";
const available =
  spawnSync(encoder, ["-version"], { windowsHide: true, timeout: 5000 }).status === 0;
const run = promisify(execFile);
const quiet = ["-hide_banner", "-loglevel", "error", "-y"];

async function loudness(file: string): Promise<number> {
  const out = await run(encoder, [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-af",
    "ebur128",
    "-f",
    "null",
    "-",
  ]);
  return Number([...out.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
}

describe.skipIf(!available)("smart cuts, joins, captions and loudness with FFmpeg", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mellox-smart-cut-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("measures a clip and skips its black, silent opening", async () => {
    const source = join(dir, "source.mp4");
    // 1 s black, 2 s moving test card, 2 s still bars; 1.5 s silence then a tone.
    await run(encoder, [
      ...quiet,
      ...["-f", "lavfi", "-i", "color=black:s=320x240:r=30:d=1"],
      ...["-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=2"],
      ...["-f", "lavfi", "-i", "smptebars=s=320x240:r=30:d=2"],
      ...["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=1.5"],
      ...["-f", "lavfi", "-i", "sine=f=440:r=48000:d=3.5"],
      "-filter_complex",
      "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a]concat=n=2:v=0:a=1[a]",
      ...["-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      source,
    ]);
    const probe = await probeVideo(source);
    const analysis = await analyzeClip(source, probe);
    expect(analysis.cuts.some((t) => Math.abs(t - 1) < 0.1)).toBe(true);
    expect(analysis.cuts.some((t) => Math.abs(t - 3) < 0.1)).toBe(true);
    expect(analysis.dark[0]?.start).toBe(0);
    expect(analysis.silences[0]).toMatchObject({ start: 0 });
    const [piece] = planClips([analysis]);
    expect(piece.start).toBeGreaterThanOrEqual(0.85);
    expect(piece.start + piece.seconds).toBeLessThanOrEqual(probe.duration + 0.01);
  }, 120_000);

  it("joins pieces with a crossfade, captions them and evens the sound", async () => {
    const make = async (name: string, colour: string, volume: string) => {
      const raw = join(dir, `${name}-raw.mp4`);
      await run(encoder, [
        ...quiet,
        ...["-f", "lavfi", "-i", `color=${colour}:s=320x568:r=30:d=3`],
        ...["-f", "lavfi", "-i", "sine=f=330:r=48000:d=3"],
        ...["-af", `volume=${volume}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
        raw,
      ]);
      const out = join(dir, `${name}.mp4`);
      await fitClip({
        input: raw,
        output: out,
        width: 360,
        height: 640,
        start: 0,
        seconds: 3,
        hasAudio: true,
      });
      return out;
    };
    const a = await make("a", "blue", "0.3");
    const b = await make("b", "blue", "0.3");
    const joined = join(dir, "joined.mp4");
    await joinWithTransitions({
      directory: dir,
      clips: [a, b],
      durations: [3, 3],
      transition: "smoothleft",
      seconds: 0.35,
      output: joined,
    });
    const probe = await probeVideo(joined);
    expect(probe.duration).toBeGreaterThan(5.5);
    expect(probe.duration).toBeLessThan(5.8);
    expect(await audioSilences(joined, probe.duration)).toEqual([]);
    expect((await extractAudio(joined, join(dir, "speech.mp3"), "mp3")).length).toBeGreaterThan(
      1000,
    );

    const canvas = { width: 360, height: 640 };
    const cues = buildCues(
      [{ start: 1, end: 3, text: "Fresh bread, baked at 6 every morning." }],
      "9:16",
      probe.duration,
    );
    const box = captionBox("9:16", canvas);
    const { blank, images } = await renderCaptionImages({
      dir,
      cues,
      colours: captionColours(["#c6f432"]),
      box,
      font: OUT ? "Montserrat" : null,
    });
    const list = await writeCaptionTrack({
      directory: dir,
      blank,
      cues: cues.map((cue, i) => ({ start: cue.start, end: cue.end, image: images[i] })),
      duration: probe.duration,
    });
    const finished = join(dir, "finished.mp4");
    await brandVideo({
      input: joined,
      output: finished,
      overlay: null,
      logo: null,
      captions: { list, y: box.y },
      loudness: true,
    });
    const out = await probeVideo(finished);
    expect(Math.abs(out.duration - probe.duration)).toBeLessThan(0.1);

    // Brought to about -14 LUFS from a much quieter recording.
    expect(await loudness(joined)).toBeLessThan(-20);
    expect(Math.abs((await loudness(finished)) + 14)).toBeLessThan(1.5);

    // The caption band shows the plate while a cue runs, the footage after.
    const band = async (t: number) => {
      const { data, info } = await sharp(await grabFrame(finished, t, join(dir, `f-${t}.png`)))
        .extract({ left: 0, top: box.y, width: canvas.width, height: box.height })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let blue = 0;
      for (let i = 0; i < data.length; i += info.channels)
        if (data[i + 2] > 200 && data[i] < 40) blue++;
      return blue / (data.length / info.channels);
    };
    expect(await band(cues[0].start + 0.1)).toBeLessThan(0.85);
    if (OUT) await grabFrame(finished, cues[0].start + 0.1, join(OUT, "captioned-frame.png"));
    expect(await band(5.5)).toBeGreaterThan(0.97);
  }, 180_000);
});
