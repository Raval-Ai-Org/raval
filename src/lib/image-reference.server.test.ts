import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
vi.mock("@/server/safe-fetch", () => ({
  safeFetch: vi.fn(async () => {
    throw new Error("offline");
  }),
}));

const { normalizeReferenceImage, REFERENCE_SIDE } = await import("./image-reference.server");

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;
const decode = (url: string) => Buffer.from(url.split(",")[1], "base64");

describe("normalizeReferenceImage", () => {
  it("brings a huge sideways TIFF upright, inside the limit, as JPEG", async () => {
    const tiff = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#3366aa" },
    })
      .withMetadata({ orientation: 6 })
      .tiff()
      .toBuffer();
    const out = await normalizeReferenceImage(dataUrl("image/tiff", tiff));
    expect(out.startsWith("data:image/jpeg;base64,")).toBe(true);
    const meta = await sharp(decode(out)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(REFERENCE_SIDE);
    // Orientation 6 is a quarter turn: the stored landscape becomes portrait.
    expect(meta.height!).toBeGreaterThan(meta.width!);
  });

  it("keeps transparency as PNG and never enlarges a small picture", async () => {
    const png = await sharp({
      create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await normalizeReferenceImage(dataUrl("image/png", png));
    expect(out.startsWith("data:image/png;base64,")).toBe(true);
    const meta = await sharp(decode(out)).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("fails open: an unreadable reference is passed on unchanged", async () => {
    const bad = dataUrl("image/jpeg", Buffer.from("not an image"));
    expect(await normalizeReferenceImage(bad)).toBe(bad);
    const remote = "https://example.com/photo.jpg";
    expect(await normalizeReferenceImage(remote)).toBe(remote);
  });
});
