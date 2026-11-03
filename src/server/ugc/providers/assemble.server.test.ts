import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { assembleVideoClips } from "./assemble.server";

const encoder = process.env.FFMPEG_PATH || "ffmpeg";
const available =
  spawnSync(encoder, ["-version"], { windowsHide: true, timeout: 5000 }).status === 0;
const run = promisify(execFile);
async function sample(color: string, audio: boolean, size = "128x96", seconds = 6) {
  const result = await run(
    encoder,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${size}:r=30`,
      ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"] : []),
      "-t",
      String(seconds),
      "-threads",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      ...(audio ? ["-c:a", "aac"] : ["-an"]),
      "-movflags",
      "frag_keyframe+empty_moov",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024, windowsHide: true },
  );
  return `data:video/mp4;base64,${result.stdout.toString("base64")}`;
}

describe.skipIf(!available)("FFmpeg video assembly", () => {
  it("creates ten seconds with matching dimensions and sound from mixed provider clips", async () => {
    const a = await sample("red", true);
    const b = await sample("blue", false, "96x128");
    const result = await assembleVideoClips(
      [
        { dataUrl: a, seconds: 4 },
        { dataUrl: b, seconds: 6 },
      ],
      true,
    );
    const directory = await mkdtemp(join(tmpdir(), "mellox-assembly-test-"));
    try {
      const path = join(directory, "result.mp4");
      await writeFile(path, Buffer.from(result.dataUrl.split(",")[1], "base64"));
      const decoded = await run(
        encoder,
        [
          "-hide_banner",
          "-i",
          path,
          "-map",
          "0:v:0",
          "-an",
          "-progress",
          "pipe:1",
          "-f",
          "null",
          "-",
        ],
        { windowsHide: true },
      );
      const times = [...decoded.stdout.matchAll(/out_time_us=(\d+)/g)];
      expect(Number(times.at(-1)?.[1]) / 1_000_000).toBeCloseTo(10, 0);
      expect(decoded.stderr).toMatch(/Video:[^\r\n]*128x96/);
      expect(decoded.stderr).toMatch(/Audio: aac/);
      expect(result.bytes).toBeGreaterThan(1000);
    } finally {
      const child = relative(resolve(tmpdir()), resolve(directory));
      if (child && !child.startsWith("..") && !child.includes(":"))
        await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects a provider that supplied less footage than the selected duration", async () => {
    const clip = await sample("red", false);
    await expect(assembleVideoClips([{ dataUrl: clip, seconds: 10 }], false)).rejects.toThrow(
      "shorter than requested",
    );
  }, 30_000);

  it("assembles a full minute without audio", async () => {
    const clip = await sample("green", false, "128x96", 15);
    const result = await assembleVideoClips(
      Array.from({ length: 4 }, () => ({ dataUrl: clip, seconds: 15 })),
      false,
    );
    const directory = await mkdtemp(join(tmpdir(), "mellox-minute-test-"));
    try {
      const path = join(directory, "minute.mp4");
      await writeFile(path, Buffer.from(result.dataUrl.split(",")[1], "base64"));
      const decoded = await run(
        encoder,
        [
          "-hide_banner",
          "-i",
          path,
          "-map",
          "0:v:0",
          "-an",
          "-progress",
          "pipe:1",
          "-f",
          "null",
          "-",
        ],
        { windowsHide: true },
      );
      const times = [...decoded.stdout.matchAll(/out_time_us=(\d+)/g)];
      expect(Number(times.at(-1)?.[1]) / 1_000_000).toBeCloseTo(60, 0);
      expect(decoded.stderr).not.toMatch(/Audio:/);
    } finally {
      const child = relative(resolve(tmpdir()), resolve(directory));
      if (child && !child.startsWith("..") && !child.includes(":"))
        await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
