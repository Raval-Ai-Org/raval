import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scrollExpression, siteFrame, siteStops, siteTimeline } from "@/lib/studio/site-reel";
import { grabFrame, probeVideo, siteScroll } from "./ffmpeg.server";
import { siteColours, siteFramePng } from "./site-frame.server";

const encoder = process.env.FFMPEG_PATH || "ffmpeg";
const available =
  spawnSync(encoder, ["-version"], { windowsHide: true, timeout: 5000 }).status === 0;

/** One flat colour per screen of the page, so a frame shows where the scroll is. */
const BANDS = [
  [230, 40, 40],
  [40, 200, 60],
  [40, 80, 230],
  [240, 200, 20],
  [160, 40, 200],
  [20, 200, 200],
];

describe("website reel colours", () => {
  it("takes a dark brand colour for the background and a coloured one for the glow", () => {
    expect(siteColours(["#ff5a1f", "#0d0d0d"])).toEqual({
      background: "#0d0d0d",
      accent: "#ff5a1f",
    });
  });
  it("never lets a stray value into the drawing", () => {
    expect(siteColours(['"/><script>', "red"])).toEqual({
      background: "#111318",
      accent: "#ffffff",
    });
  });
});

describe.skipIf(!available)("website reel render", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mellox-site-test-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("scrolls the real page inside the device and loops back to the top", async () => {
    const canvas = { width: 720, height: 900 };
    const { screen } = siteFrame(canvas, "phone");
    const pageHeight = screen.h * BANDS.length;
    const page = join(dir, "page.png");
    await sharp({
      create: { width: screen.w, height: pageHeight, channels: 3, background: "#000" },
    })
      .composite(
        await Promise.all(
          BANDS.map(async ([r, g, b], i) => ({
            input: await sharp({
              create: { width: screen.w, height: screen.h, channels: 3, background: { r, g, b } },
            })
              .png()
              .toBuffer(),
            top: i * screen.h,
            left: 0,
          })),
        ),
      )
      .png()
      .toFile(page);
    const frame = join(dir, "frame.png");
    await writeFile(
      frame,
      await siteFramePng({ canvas, device: "phone", colours: ["#0d0d0d", "#ff5a1f"] }),
    );
    const stops = siteStops(pageHeight, screen.h);
    const { segments, total } = siteTimeline(stops);
    const output = join(dir, "reel.mp4");
    await siteScroll({
      page,
      frame,
      output,
      ...canvas,
      screen,
      scroll: scrollExpression(segments),
      seconds: total,
    });

    const probe = await probeVideo(output);
    expect(probe).toMatchObject({ width: 720, height: 900 });
    expect(probe.duration).toBeGreaterThan(total - 0.2);
    expect(probe.duration).toBeLessThan(total + 0.2);

    const centre = async (seconds: number, name: string) => {
      const png = await grabFrame(output, seconds, join(dir, name));
      const { data } = await sharp(png)
        .extract({
          left: Math.round(screen.x + screen.w / 2),
          top: Math.round(screen.y + screen.h / 2),
          width: 1,
          height: 1,
        })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return [...data.subarray(0, 3)];
    };
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 40);
    // Resting on the top of the page at the start and again at the end.
    expect(near(await centre(0.3, "start.png"), BANDS[0])).toBe(true);
    expect(near(await centre(total - 0.1, "end.png"), BANDS[0])).toBe(true);
    // A later hold rests on a later part of the page.
    const hold = segments.find((s) => s.from === s.to && s.from > 0)!;
    const band = Math.floor((hold.from + screen.h / 2) / screen.h);
    expect(near(await centre((hold.start + hold.end) / 2, "hold.png"), BANDS[band])).toBe(true);
    // The device and background stay drawn around the screen.
    const corner = await sharp(await grabFrame(output, 1, join(dir, "corner.png")))
      .extract({ left: 4, top: 4, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(corner[0]).toBeLessThan(80);
  }, 120_000);
});
