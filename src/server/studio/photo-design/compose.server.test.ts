import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composePhotoDesign } from "./compose.server";
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
