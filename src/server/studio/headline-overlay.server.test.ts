import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Set CAROUSEL_SMOKE_OUT=<dir> to fetch the real font and write the result.
const OUT = process.env.CAROUSEL_SMOKE_OUT;
if (!OUT) {
  vi.doMock("@/server/safe-fetch", () => ({
    safeFetch: async () => ({ ok: false, status: 503, bytes: new Uint8Array(0), text: () => "" }),
  }));
}
const { drawHeadlineOverlay } = await import("./headline-overlay.server");

/** A picture with a calm sky on top and busy stripes below. */
async function picture(): Promise<Buffer> {
  const w = 1024;
  const h = 1280;
  const stripes = Buffer.alloc(w * (h / 2) * 3);
  for (let i = 0; i < stripes.length; i += 3) {
    const x = (i / 3) % w;
    const v = x % 8 < 4 ? 30 : 220;
    stripes[i] = v;
    stripes[i + 1] = v;
    stripes[i + 2] = v;
  }
  const busy = await sharp(stripes, { raw: { width: w, height: h / 2, channels: 3 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: "#2b4c7e" } })
    .composite([{ input: busy, left: 0, top: h / 2 }])
    .jpeg()
    .toBuffer();
}

describe("drawHeadlineOverlay", () => {
  it("sets the headline on the calm top band, keeping the picture's shape", async () => {
    const art = await picture();
    const out = await drawHeadlineOverlay({
      art,
      overlay: { headline: "Fresh every morning", brandName: "Slow Pour", font: "Inter" },
    });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "overlay.jpg"), out);
    }
    // White ink in the calm top band, where the plain picture has none.
    const white = async (img: Buffer) => {
      const { data } = await sharp(img)
        .resize(1080, 1350)
        .extract({ left: 0, top: 0, width: 1080, height: 450 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += 3)
        if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) n++;
      return n;
    };
    expect(await white(art)).toBe(0);
    expect(await white(out)).toBeGreaterThan(2000);
  }, 60_000);

  it("refuses words no font here can draw", async () => {
    await expect(
      drawHeadlineOverlay({
        art: await picture(),
        overlay: { headline: "ताज़ा हर सुबह", brandName: "Slow Pour", font: "Inter" },
      }),
    ).rejects.toThrow();
  });
});
