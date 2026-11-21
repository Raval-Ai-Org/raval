import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeFittedPhotos, composePhotoDesign } from "./compose.server";
import { planPhotoDesign } from "@/lib/studio/photo-design/plan";
import { NEUTRAL_READING } from "@/lib/studio/photo-design/read";

const BLUE = [10, 20, 240];
const YELLOW = [250, 220, 5];
const RED = [200, 30, 30];

/** A photo whose left half is blue and right half yellow. */
async function photo(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(x < width / 2 ? BLUE : YELLOW, (y * width + x) * 3);
  const bytes = await sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  return { bytes, width, height };
}

/** A red design with one flat green window. */
async function layer(window: { x: number; y: number; w: number; h: number } | null) {
  const width = 512;
  const height = 640;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) raw.set(RED, i * 3);
  if (window)
    for (let y = window.y; y < window.y + window.h; y++)
      for (let x = window.x; x < window.x + window.w; x++)
        raw.set([0, 255, 0], (y * width + x) * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}

const plan = () =>
  planPhotoDesign({
    readings: [NEUTRAL_READING],
    sizes: [{ width: 400, height: 300 }],
    ratio: "4:5",
    copy: [],
    brief: "a framed poster",
  });

describe("laying real photos into a design layer", () => {
  it("shows the photo's own pixels inside the window and the design outside", async () => {
    const result = await composePhotoDesign({
      layer: await layer({ x: 100, y: 150, w: 300, h: 225 }),
      photos: [await photo(400, 300)],
      readings: [NEUTRAL_READING],
      plan: plan(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await pixel(result.png, 160, 260)).toEqual(BLUE);
    expect(await pixel(result.png, 340, 260)).toEqual(YELLOW);
    expect(await pixel(result.png, 20, 20)).toEqual(RED);
  });

  it("lenient pass uses a too-small window instead of refusing", async () => {
    const args = {
      layer: await layer({ x: 180, y: 240, w: 120, h: 150 }),
      photos: [await photo(400, 300)],
      readings: [NEUTRAL_READING],
      plan: plan(),
    };
    expect((await composePhotoDesign(args)).ok).toBe(false);
    const loose = await composePhotoDesign({ ...args, lenient: true });
    expect(loose.ok).toBe(true);
  });

  it("lenient pass fills the windows there are when fewer than the photos", async () => {
    const two = planPhotoDesign({
      readings: [NEUTRAL_READING, NEUTRAL_READING],
      sizes: [
        { width: 400, height: 300 },
        { width: 300, height: 400 },
      ],
      ratio: "4:5",
      copy: [],
      brief: "a collage",
    });
    const result = await composePhotoDesign({
      layer: await layer({ x: 100, y: 150, w: 300, h: 225 }),
      photos: [await photo(400, 300), await photo(300, 400)],
      readings: [NEUTRAL_READING, NEUTRAL_READING],
      plan: two,
      lenient: true,
    });
    expect(result.ok).toBe(true);
  });

  it("lays photos out by code at the exact canvas size, whatever their shape", async () => {
    for (const [w, h] of [
      [270, 480],
      [480, 150],
      [201, 251],
      [3, 500],
    ]) {
      const png = await composeFittedPhotos({
        photos: [await photo(w, h)],
        readings: [NEUTRAL_READING],
        plan: { order: [0], ratio: "4:5" },
        width: 1024,
        height: 1280,
      });
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height]).toEqual([1024, 1280]);
    }
    const grid = await composeFittedPhotos({
      photos: await Promise.all([photo(400, 300), photo(100, 300), photo(201, 199)]),
      readings: [NEUTRAL_READING, NEUTRAL_READING, NEUTRAL_READING],
      plan: { order: [0, 1, 2], ratio: "9:16" },
    });
    const meta = await sharp(grid).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1820]);
  }, 30_000);

  it("refuses a layer that left no room for the photo", async () => {
    const result = await composePhotoDesign({
      layer: await layer(null),
      photos: [await photo(400, 300)],
      readings: [NEUTRAL_READING],
      plan: plan(),
    });
    expect(result.ok).toBe(false);
  });
});
