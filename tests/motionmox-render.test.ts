// A real MotionMox render: a generated clip with sound, two photos and an end
// card, with the planned elements animated in. Slow (Chromium + encoding), so
// it runs only with MOTIONMOX_RENDER_TEST=yes and a built bundle
// (npm run motionmox:bundle). Uses the compositor's own ffmpeg/ffprobe.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { planMotionMox } from "@/lib/studio/motionmox/plan";
import { groundSpec, specSeconds } from "@/lib/studio/motionmox/spec";
import { renderMotionMox } from "@/server/studio/motionmox/render.server";
import { resolveRequest } from "@/server/studio/motionmox/files.server";

const run = process.env.MOTIONMOX_RENDER_TEST === "yes";
const bin = join(
  process.cwd(),
  "node_modules",
  "@motionmox",
  process.platform === "win32" ? "compositor-win32-x64-msvc" : "compositor-linux-x64-gnu",
);
const exe = (name: string) => join(bin, process.platform === "win32" ? `${name}.exe` : name);
const dir = mkdtempSync(join(process.env.MOTIONMOX_TMP || tmpdir(), "motionmox-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("render file server", () => {
  it("serves only plain names under the token", () => {
    expect(resolveRequest("GET", "/tok/clip-0.mp4", "tok")).toBe("clip-0.mp4");
    expect(resolveRequest("GET", "/tok/clip-0.mp4?x=1", "tok")).toBe("clip-0.mp4");
    expect(resolveRequest("GET", "/other/clip-0.mp4", "tok")).toBeNull();
    expect(resolveRequest("GET", "/tok/..%2F..%2Fsecret", "tok")).toBeNull();
    expect(resolveRequest("GET", "/tok/a/b.png", "tok")).toBeNull();
    expect(resolveRequest("POST", "/tok/clip-0.mp4", "tok")).toBeNull();
  });
});

describe.runIf(run)("MotionMox render", () => {
  it(
    "draws a branded clip with sound, a price tag and a button",
    async () => {
      // The compositor's FFmpeg is a small build (no test-pattern filter): a
      // looped picture with a tone is the clip.
      await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#3366cc" } })
        .png()
        .toFile(join(dir, "frame.png"));
      execFileSync(exe("ffmpeg"), [
        "-y",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        "4",
        "-i",
        join(dir, "frame.png"),
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=4",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        join(dir, "clip-0.mp4"),
      ]);
      for (const [name, colour] of [
        ["photo-0.png", "#0b3d2e"],
        ["end.png", "#f4c430"],
      ] as const)
        await sharp({ create: { width: 720, height: 1280, channels: 3, background: colour } })
          .png()
          .toFile(join(dir, name));

      const { spec: planned, allowedText } = planMotionMox({
        canvas: { width: 720, height: 1280 },
        segments: [
          { kind: "video", src: "clip-0.mp4", seconds: 4, sound: true },
          { kind: "image", src: "photo-0.png", seconds: 3, zoom: 1.08 },
          { kind: "image", src: "end.png", seconds: 2, zoom: 1.04 },
        ],
        endCard: true,
        transition: "fade",
        transitionSeconds: 0.4,
        copy: [
          { label: "Headline", text: "Same-day plumbing" },
          { label: "Support line", text: "From Rs 2,500" },
        ],
        endCopy: [],
        brief: "add a price tag and end with 'Book now'",
        brandName: "Acme",
        asked: ["headline", "price-tag", "cta", "progress-bar"],
        overlay: null,
        overlaySeconds: 4,
        captions: [{ start: 0.5, end: 2, lines: [["We", "fix", "it"]], emphasis: [0, 1] }],
        logo: null,
        colours: ["#0b3d2e", "#f4c430", "#ffffff"],
        font: null,
      });
      const { spec, dropped } = groundSpec(planned, allowedText);
      expect(dropped).toEqual([]);
      expect(spec.texts.map((t) => t.element).sort()).toEqual(["cta", "headline", "price-tag"]);

      const out = await renderMotionMox({ spec, dir });
      expect(existsSync(out)).toBe(true);
      const probe = JSON.parse(
        execFileSync(
          exe("ffprobe"),
          ["-v", "error", "-show_streams", "-show_format", "-of", "json", out],
          {
            encoding: "utf8",
          },
        ),
      );
      const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
      const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
      expect(video.width).toBe(720);
      expect(video.height).toBe(1280);
      expect(video.codec_name).toBe("h264");
      expect(audio).toBeTruthy();
      expect(Number(probe.format.duration)).toBeCloseTo(specSeconds(spec), 0);
    },
    10 * 60_000,
  );

  it(
    "fails plainly on a missing file, so the FFmpeg path takes over",
    async () => {
      const { spec } = groundSpec(
        {
          version: 1,
          width: 720,
          height: 1280,
          fps: 30,
          segments: [{ kind: "video", src: "missing.mp4", seconds: 2 }],
          transition: "none",
          transitionSeconds: 0,
          overlay: null,
          texts: [],
          captions: [],
          logo: null,
          progressBar: false,
          look: { ink: "#111111", paper: "#ffffff", accent: "#f4c430", font: null },
          safe: { x: 0.06, top: 0.08, bottom: 0.12 },
        },
        [],
      );
      await expect(renderMotionMox({ spec, dir, output: join(dir, "bad.mp4") })).rejects.toThrow();
    },
    5 * 60_000,
  );
});
