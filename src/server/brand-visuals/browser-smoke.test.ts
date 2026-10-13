import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("@/server/safe-fetch", async (original) => ({
  ...(await original<typeof import("@/server/safe-fetch")>()),
  safeFetch: fetch,
}));
vi.mock("@/server/studio/carousel-render.server", () => ({ loadFonts: async () => [] }));
import { captureVisualPage } from "./capture.server";
import { sampleVideoFrames } from "./video-frames.server";
import { composeVisualArtwork } from "./compose.server";
import { ProfileSchema } from "@/lib/brand-visuals/contracts";

// Explicit opt-in: uses an installed isolated Chromium, no model calls or database writes.
describe.skipIf(!process.env.VISUAL_BROWSER_SMOKE)("visual renderer smoke", () => {
  beforeEach(() => fetch.mockReset());
  it("captures lazy imagery, page sections, measured type and mobile coverage through guarded requests", async () => {
    const pixel = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#455d49" },
    })
      .png()
      .toBuffer();
    const html = `<!doctype html><html><head><style>body{margin:0;background:#f3efe5}section{height:1300px;padding:20px;box-sizing:border-box}h1,h2{font-family:Georgia;color:#162d44}img{width:400px;height:300px;max-width:100%}</style></head><body><main><section><h1>Painted outdoors</h1><img src="https://brand.test/art.png"/></section><section><h2>Thoughtfully made</h2><img loading="lazy" src="https://brand.test/lazy.png"/><a href="/about">About</a></section></main><script>fetch('http://169.254.169.254/latest').catch(()=>{});fetch('/submit',{method:'POST'}).catch(()=>{})</script></body></html>`;
    fetch.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      const image = url.endsWith(".png");
      return {
        ok: true,
        status: 200,
        url,
        bytes: image ? pixel : Buffer.from(html),
        headers: new Headers({ "content-type": image ? "image/png" : "text/html" }),
      };
    });
    const desktop = await captureVisualPage("https://brand.test/");
    expect(desktop.complete).toBe(true);
    expect(desktop.height).toBe(2600);
    expect(desktop.images.length).toBeGreaterThan(2);
    expect(desktop.tokens.headings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "Georgia", color: "rgb(22, 45, 68)" }),
      ]),
    );
    expect(fetch.mock.calls.map((c) => String(c[0]))).not.toContain(
      "http://169.254.169.254/latest",
    );
    expect(fetch.mock.calls.map((c) => String(c[0]))).not.toContain("https://brand.test/submit");
    const mobile = await captureVisualPage("https://brand.test/", true);
    expect(mobile.width).toBe(390);
    expect(mobile.images[0].region.mobile).toBe(true);
    mkdirSync(".tmp-run", { recursive: true });
    writeFileSync(".tmp-run/capture-smoke-desktop.png", desktop.images[0].bytes);
  }, 120000);
  it("marks very long pages as partial instead of claiming full coverage", async () => {
    fetch.mockImplementation(async (input: string | URL) => ({
      ok: true,
      status: 200,
      url: String(input),
      bytes: Buffer.from(
        '<html><body style="margin:0;height:19000px;background:#f3efe5"><h1>Long page</h1></body></html>',
      ),
      headers: new Headers({ "content-type": "text/html" }),
    }));
    const result = await captureVisualPage("https://brand.test/long");
    expect(result.complete).toBe(false);
    expect(result.height).toBe(18000);
    expect(result.warnings[0]).toMatch(/limit/);
  }, 60000);
  it("decodes three separate frames from an owned video offline", async () => {
    const result = await sampleVideoFrames(
      readFileSync("public/Home/wall/reel-4.mp4"),
      "video/mp4",
    );
    expect(result.duration).toBeGreaterThan(0);
    expect(result.frames).toHaveLength(3);
    expect(result.frames[1].time).toBeGreaterThan(result.frames[0].time);
    for (const frame of result.frames)
      expect((await sharp(frame.bytes).metadata()).width).toBeGreaterThan(0);
  }, 60000);
  it("renders editable artwork at exact platform dimensions with a long headline", async () => {
    const art = await sharp({
      create: { width: 500, height: 500, channels: 3, background: "#455d49" },
    })
      .png()
      .toBuffer();
    const direction = ProfileSchema.parse({
      directions: [
        {
          name: "Painted editorial",
          summary: "Warm cream with navy type",
          visual: { palette: { background: "#f3efe5", text: "#162d44", primary: "#455d49" } },
          layout: "editorial",
        },
      ],
    }).directions[0];
    const bytes = await composeVisualArtwork({
      art,
      snapshot: { profileId: "test", direction, rules: "", references: [], warnings: [] },
      headline:
        "An unusually long but clearly written headline that should remain readable on a portrait post",
      brandName: "Northside",
      ratio: "4:5",
    });
    const dimensions = await sharp(bytes).metadata();
    expect(dimensions.width).toBe(1080);
    expect(dimensions.height).toBe(1350);
    writeFileSync(".tmp-run/composition-smoke.jpg", bytes);
  }, 60000);
});
