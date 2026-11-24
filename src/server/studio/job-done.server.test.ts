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
const { drawJobDone } = await import("./job-done.server");

const flat = (background: string, width = 1200, height = 900) =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

describe("drawJobDone", () => {
  it("keeps both real photos, before first, at the post's size", async () => {
    const out = await drawJobDone({
      before: await flat("#7a5c3c"),
      after: await flat("#3c7a5c", 900, 1400),
      ratio: "4:5",
    });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    // Middle of the top panel is the before photo, the bottom one the after.
    const px = async (y: number) =>
      (await sharp(out).extract({ left: 540, top: y, width: 1, height: 1 }).raw().toBuffer())[0];
    expect(Math.abs((await px(300)) - 0x7a)).toBeLessThan(12);
    expect(Math.abs((await px(1000)) - 0x3c)).toBeLessThan(12);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "job-done.jpg"), out);
    }
  }, 60_000);

  it("sets square posts side by side", async () => {
    const out = await drawJobDone({
      before: await flat("#222222"),
      after: await flat("#dddddd"),
      ratio: "1:1",
    });
    const px = async (x: number) =>
      (await sharp(out).extract({ left: x, top: 300, width: 1, height: 1 }).raw().toBuffer())[0];
    expect(await px(200)).toBeLessThan(60);
    expect(await px(880)).toBeGreaterThan(200);
  }, 60_000);
});
