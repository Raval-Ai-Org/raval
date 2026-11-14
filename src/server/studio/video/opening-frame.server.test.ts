import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { looksLetterboxed } from "@/lib/studio/video/opening-frame";
import { placeBrandLogo } from "../logo-overlay.server";
import { frameForVideo } from "./finish.server";
import { frameProfile } from "./opening-frame.server";

/** A busy, photo-like picture: random blocks of colour. */
async function busyPicture(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let by = 0; by < height; by += 16)
    for (let bx = 0; bx < width; bx += 16) {
      const c = [rand() * 255, rand() * 255, rand() * 255];
      for (let y = by; y < Math.min(height, by + 16); y++)
        for (let x = bx; x < Math.min(width, bx + 16); x++) pixels.set(c, (y * width + x) * 3);
    }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe("frameProfile + looksLetterboxed on real pixels", () => {
  it("finds a square post laid whole on a 9:16 canvas, the way the bad Reel was made", async () => {
    const framed = await frameForVideo(await busyPicture(1024, 1024), "9:16");
    expect(looksLetterboxed(await frameProfile(framed))).toBe(true);
  });

  it("passes a picture that fills the 9:16 frame", async () => {
    const full = await busyPicture(720, 1280);
    expect(looksLetterboxed(await frameProfile(full))).toBe(false);
  });
});

describe("placeBrandLogo", () => {
  it("moves the logo off words in its corner to a calm one", async () => {
    // A calm sky-blue picture with dark 'letters' in the bottom-right corner.
    const w = 1024;
    const h = 1280;
    const stripes = Array.from(
      { length: 12 },
      (_, i) => `<rect x="${640 + i * 30}" y="1080" width="14" height="150" fill="#0b2a5a"/>`,
    ).join("");
    const picture = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#bfe0f5"/>${stripes}</svg>`,
      ),
    )
      .png()
      .toBuffer();
    const logo = await sharp({
      create: { width: 200, height: 80, channels: 4, background: "#123d2a" },
    })
      .png()
      .toBuffer();
    const placed = await placeBrandLogo(
      `data:image/png;base64,${picture.toString("base64")}`,
      `data:image/png;base64,${logo.toString("base64")}`,
      "bottom-right",
    );
    expect(placed.placement?.skipped).toBe(false);
    expect(placed.placement?.corner).not.toBe("bottom-right");
    expect(placed.placement?.moved).toBe(true);
  });
});
