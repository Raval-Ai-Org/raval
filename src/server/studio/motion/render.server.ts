// Draws a motion graphic: Chromium lays out the checked document, every CSS
// animation is paused and moved to each frame's time, and FFmpeg turns the
// frames into an H.264 MP4. Rules and checks are in src/lib/studio/motion/.
//
// The page is drawn offline: its policy refuses scripts and every address but
// data:, and every request the page still makes is aborted. One drawing at a
// time per process, so a small server never runs two browsers at once.
import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Browser, Page } from "playwright-core";
import {
  contrastRatio,
  parseRgb,
  type MeasuredPage,
  type MeasuredText,
  type MotionCanvas,
} from "@/lib/studio/motion/document";
import { launchVisualBrowser } from "@/server/brand-visuals/browser.server";

export const MOTION_FPS = 30;
const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";

/* ─────────────────────────── one at a time ─────────────────────────── */

let queue: Promise<unknown> = Promise.resolve();

/** Runs `work` after every drawing before it has finished. */
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

async function withPage<T>(html: string, canvas: MotionCanvas, work: (page: Page) => Promise<T>) {
  return oneAtATime(async () => {
    let browser: Browser | null = null;
    try {
      browser = await launchVisualBrowser();
      const context = await browser.newContext({
        viewport: canvas,
        deviceScaleFactor: 1,
        offline: true,
        serviceWorkers: "block",
        reducedMotion: "no-preference",
      });
      await context.route("**/*", (route) =>
        route.request().url().startsWith("data:") ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // Every animation stops; frames are drawn by moving them, never by waiting.
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.pause();
      });
      return await work(page);
    } finally {
      await browser?.close().catch(() => undefined);
    }
  });
}

async function seek(page: Page, seconds: number) {
  await page.evaluate((ms) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = ms;
    }
  }, seconds * 1000);
}

/* ─────────────────────────────── measuring ─────────────────────────────── */

type RawText = Omit<MeasuredText, "t"> & { color: string };

/** Every visible line of text on the page right now, with its box and look. */
function readTexts(page: Page): Promise<RawText[]> {
  return page.evaluate(() => {
    const out: {
      text: string;
      box: { x: number; y: number; width: number; height: number };
      fontSize: number;
      opacity: number;
      color: string;
    }[] = [];
    const walker = document.createTreeWalker(
      document.getElementById("stage")!,
      NodeFilter.SHOW_TEXT,
    );
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent?.trim()) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement)
        opacity *= Number(getComputedStyle(e).opacity || 1);
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // Scale from transforms counts towards the size a viewer reads.
      const scale = el.getBoundingClientRect().height / Math.max(1, el.offsetHeight || r.height);
      out.push({
        text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
        fontSize: parseFloat(style.fontSize) * (Number.isFinite(scale) && scale > 0 ? scale : 1),
        opacity,
        color: style.color,
      });
    }
    return out;
  });
}

/** When the last animation stops moving (seconds; Infinity for an endless one). */
function readLastMotion(page: Page): Promise<number> {
  return page.evaluate(() => {
    let end = 0;
    for (const animation of document.getAnimations()) {
      const t = animation.effect?.getComputedTiming().endTime;
      const value = typeof t === "number" ? t : Number(t);
      if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
      end = Math.max(end, value);
    }
    return end / 1000;
  });
}

/** The colour most of a box shows (its background, since letters cover less of it). */
async function backgroundOf(shot: Buffer, box: MeasuredText["box"], canvas: MotionCanvas) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const width = Math.min(canvas.width - left, Math.ceil(box.width));
  const height = Math.min(canvas.height - top, Math.ceil(box.height));
  if (width < 2 || height < 2) return null;
  const { data, info } = await sharp(shot)
    .extract({ left, top, width, height })
    .resize({ width: Math.min(width, 64), fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels: [number, number, number][] = [];
  for (let i = 0; i + 2 < data.length; i += info.channels)
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  pixels.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return pixels[Math.floor(pixels.length / 2)] ?? null;
}

/** Times to look at: a few during the piece and two in the end hold. */
export function sampleTimes(seconds: number): number[] {
  const times = [0.3, 1, 1.5];
  for (let t = 2; t < seconds - 1; t += 1) times.push(t);
  times.push(Math.max(0, seconds - 1), Math.max(0, seconds - 0.1));
  return [...new Set(times.map((t) => Math.round(t * 10) / 10))].filter((t) => t <= seconds);
}

/**
 * Lay the page out and measure it, without making the video: what text shows
 * where and when, how readable it is, and when motion ends. Fast (a few
 * screenshots), so a bad design is found before the full drawing.
 */
export function inspectMotion(
  html: string,
  canvas: MotionCanvas,
  seconds: number,
): Promise<MeasuredPage> {
  return withPage(html, canvas, async (page) => {
    const texts: MeasuredText[] = [];
    const contrasts: MeasuredPage["contrasts"] = [];
    for (const t of sampleTimes(seconds)) {
      await seek(page, t);
      const found = await readTexts(page);
      const shot = await page.screenshot({ type: "png" });
      for (const text of found) {
        texts.push({
          t,
          text: text.text,
          box: text.box,
          fontSize: text.fontSize,
          opacity: text.opacity,
        });
        if (text.opacity < 0.95) continue;
        const fg = parseRgb(text.color);
        const bg = await backgroundOf(shot, text.box, canvas).catch(() => null);
        if (fg && bg) contrasts.push({ text: text.text, ratio: contrastRatio(fg, bg) });
      }
    }
    return { canvas, texts, lastMotion: await readLastMotion(page), contrasts };
  });
}

/* ─────────────────────────────── drawing ─────────────────────────────── */

/**
 * Draw every frame and encode the MP4 (silent; the soundtrack is mixed after).
 * Also returns a few frames for the visual check.
 */
export function renderMotion(
  html: string,
  canvas: MotionCanvas,
  seconds: number,
): Promise<{ video: Buffer; samples: Buffer[] }> {
  return withPage(html, canvas, async (page) => {
    const frames = Math.round(seconds * MOTION_FPS);
    const sampleEvery = Math.max(1, Math.floor(frames / 6));
    const samples: Buffer[] = [];
    // An MP4 can't be written to a pipe (the muxer seeks back for its index,
    // and +faststart moves it to the front), so it goes to a temporary file.
    const dir = await mkdtemp(join(tmpdir(), "mellox-motion-"));
    const output = join(dir, "motion.mp4");
    const encoder = spawn(
      ffmpeg(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-threads",
        "2",
        "-f",
        "image2pipe",
        "-framerate",
        String(MOTION_FPS),
        "-c:v",
        "mjpeg",
        "-i",
        "pipe:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(MOTION_FPS),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        output,
      ],
      { windowsHide: true },
    );
    let errors = "";
    encoder.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-2000);
    });
    const done = new Promise<void>((resolve, reject) => {
      encoder.on("error", reject);
      encoder.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${errors.trim()}`)),
      );
    });
    // A failed encoder is reported by the write or the await below, never as
    // an unhandled rejection.
    done.catch(() => {});
    const write = (frame: Buffer) =>
      new Promise<void>((resolve, reject) =>
        encoder.stdin.write(frame, (error) => (error ? reject(error) : resolve())),
      );
    try {
      for (let i = 0; i < frames; i++) {
        await seek(page, i / MOTION_FPS);
        const frame = await page.screenshot({ type: "jpeg", quality: 92, caret: "initial" });
        if (i % sampleEvery === 0 || i === frames - 1) samples.push(frame);
        await write(frame);
      }
      encoder.stdin.end();
      await done;
      return { video: await readFile(output), samples: samples.slice(-7) };
    } catch (error) {
      encoder.kill("SIGKILL");
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
