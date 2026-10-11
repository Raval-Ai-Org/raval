#!/usr/bin/env node
/**
 * Saves the product film (/promo-lab) as an MP4, one exact frame at a time.
 *
 * The film is a pure function of time, so this never depends on how fast the
 * machine is: seek, screenshot, send the picture to ffmpeg, repeat.
 *
 *   node scripts/record-promo.mjs                 -> promo/mellox-tour.mp4
 *   node scripts/record-promo.mjs --stills 1,5,12 -> PNGs at those seconds
 *
 * Needs a dev server (PROMO_URL, default http://localhost:8081) and, for the
 * MP4, an ffmpeg with H.264 (FFMPEG_PATH, default "ffmpeg" on PATH).
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const FPS = 30;
const DURATION = 40;
const WIDTH = 1920;
const HEIGHT = 1080;

const base = process.env.PROMO_URL ?? "http://localhost:8081";
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const out = path.resolve(process.env.PROMO_OUT ?? "promo/mellox-tour.mp4");
const stillsAt = process.argv.includes("--stills")
  ? (process.argv[process.argv.indexOf("--stills") + 1] ?? "")
      .split(",")
      .map(Number)
      .filter(Number.isFinite)
  : null;
const stillsDir = path.resolve(process.env.PROMO_STILLS_DIR ?? "promo/stills");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
page.on("pageerror", (error) => console.error("[page error]", error.message));
// Only the app and its fonts: no analytics from a recording run.
await page.route("**/*", (route) => {
  const { hostname } = new URL(route.request().url());
  const allowed =
    hostname === new URL(base).hostname || /(^|\.)(googleapis|gstatic)\.com$/.test(hostname);
  return allowed ? route.continue() : route.abort();
});

await page.goto(`${base}/promo-lab?record=1`, { waitUntil: "networkidle", timeout: 180_000 });
// The dev-only Next.js badge must not end up in the film.
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.waitForFunction(() => typeof window.__promoSeek === "function", null, {
  timeout: 60_000,
});
await page.evaluate(() => document.fonts.ready);

const shoot = async (seconds) => {
  await page.evaluate((time) => window.__promoSeek(time), seconds);
  return page.screenshot({ type: "png" });
};

// Draw every scene once first so fonts and logos are in before frame 0.
for (let seconds = 0; seconds < DURATION; seconds += 0.5)
  await page.evaluate((time) => window.__promoSeek(time), seconds);

if (stillsAt) {
  mkdirSync(stillsDir, { recursive: true });
  for (const seconds of stillsAt) {
    const file = path.join(stillsDir, `t${seconds.toFixed(2).padStart(5, "0")}.png`);
    await page.evaluate((time) => window.__promoSeek(time), seconds);
    await page.screenshot({ type: "png", path: file });
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

mkdirSync(path.dirname(out), { recursive: true });
const encoder = spawn(
  ffmpeg,
  [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(FPS),
    "-c:v",
    "png",
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "15",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-r",
    String(FPS),
    out,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
encoder.on("error", (error) => {
  console.error(`Could not start ffmpeg (${ffmpeg}): ${error.message}`);
  process.exit(1);
});

const frames = DURATION * FPS;
for (let frame = 0; frame < frames; frame++) {
  const picture = await shoot(frame / FPS);
  if (!encoder.stdin.write(picture)) await once(encoder.stdin, "drain");
  if (frame % 150 === 0) console.log(`frame ${frame} / ${frames}`);
}
encoder.stdin.end();
const [code] = await once(encoder, "close");
await browser.close();
if (code !== 0) {
  console.error(`ffmpeg exited with ${code}`);
  process.exit(1);
}
console.log(`Saved ${out}`);
