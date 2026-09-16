import { describe, expect, it } from "vitest";
import { probeImage, referenceImageProblem } from "@/lib/ugc/image-probe";
import { evidenceOnPage, parseProductPage } from "@/lib/ugc/product-page";
import { brandSnapshot } from "./service.server";
import { callbackTaskId, signKieCallback, verifyKieCallback } from "./webhook.server";

describe("Kie callback verification", () => {
  const key = "test-hmac-key-0123456789";
  const now = 1_789_570_000;
  const body = JSON.stringify({
    code: 200,
    data: { taskId: "92de474bed1b5a7083bd2577c221e7d0", info: {} },
  });
  const ts = String(now);
  const sig = signKieCallback("92de474bed1b5a7083bd2577c221e7d0", ts, key);

  it("accepts a correctly signed, fresh callback", () => {
    expect(
      verifyKieCallback({ rawBody: body, signature: sig, timestamp: ts, key, nowSeconds: now + 5 }),
    ).toEqual({
      ok: true,
      taskId: "92de474bed1b5a7083bd2577c221e7d0",
    });
  });

  it("rejects tampered, stale, unsigned and unconfigured callbacks", () => {
    const other = body.replace("92de474b", "00000000");
    expect(
      verifyKieCallback({ rawBody: other, signature: sig, timestamp: ts, key, nowSeconds: now }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      verifyKieCallback({
        rawBody: body,
        signature: sig,
        timestamp: ts,
        key,
        nowSeconds: now + 3600,
      }),
    ).toMatchObject({ ok: false, reason: "stale timestamp" });
    expect(
      verifyKieCallback({ rawBody: body, signature: null, timestamp: ts, key, nowSeconds: now }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      verifyKieCallback({ rawBody: body, signature: sig, timestamp: ts, key: undefined }),
    ).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(verifyKieCallback({ rawBody: "{", signature: sig, timestamp: ts, key })).toMatchObject({
      status: 400,
    });
  });

  it("reads the task id from Veo and market callback shapes only when well-formed", () => {
    expect(callbackTaskId({ data: { task_id: "abc123def" } })).toBe("abc123def");
    expect(callbackTaskId({ taskId: "../../etc" })).toBeNull();
  });
});

describe("reference image probing", () => {
  function png(w: number, h: number) {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(b.buffer);
    view.setUint32(16, w);
    view.setUint32(20, h);
    return b;
  }
  function jpeg(w: number, h: number) {
    return new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      h >> 8,
      h & 255,
      w >> 8,
      w & 255,
      3,
      0,
      0,
      0,
    ]);
  }

  it("identifies PNG and JPEG by bytes and reads the size", () => {
    expect(probeImage(png(1024, 1536))).toEqual({ mime: "image/png", width: 1024, height: 1536 });
    expect(probeImage(jpeg(800, 600))).toEqual({ mime: "image/jpeg", width: 800, height: 600 });
    expect(probeImage(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it("enforces the video models' image limits", () => {
    expect(referenceImageProblem(probeImage(png(1024, 1024)), 1000)).toBeNull();
    expect(referenceImageProblem(probeImage(png(200, 200)), 1000)).toMatch(/300px/);
    expect(referenceImageProblem(probeImage(png(3000, 1000)), 1000)).toMatch(
      /too tall or too wide/,
    );
    expect(referenceImageProblem(null, 1000)).toMatch(/PNG, JPEG or WebP/);
    expect(referenceImageProblem(probeImage(png(1024, 1024)), 11 * 1024 * 1024)).toMatch(/10 MB/);
  });
});

describe("product page parsing", () => {
  const html = `<html><head><title>Glow Serum | Lumen</title>
    <meta property="og:site_name" content="Lumen Skincare">
    <meta property="og:image" content="/img/og.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Lumen"},
      {"@type":"Product","name":"Glow Serum","brand":{"@type":"Brand","name":"Lumen"},
       "description":"Vitamin C serum with 15% L-ascorbic acid.","image":["https://cdn.lumen.example/p/serum-1.jpg"],
       "offers":{"@type":"Offer","price":"29.00","priceCurrency":"USD"},"category":"Beauty > Skincare > Serums"}]}</script>
    </head><body><h1>Glow Serum</h1><img src="/icons/logo.png"><img src="https://cdn.lumen.example/products/serum-2.jpg" alt="Glow Serum bottle">
    <p>Fragrance-free and vegan. 30 ml glass dropper bottle.</p></body></html>`;

  it("reads schema.org Product data, images and text", () => {
    const p = parseProductPage(html, "https://lumen.example/serum");
    expect(p).toMatchObject({
      name: "Glow Serum",
      brand: "Lumen",
      price: "USD 29.00",
      category: "Serums",
      structured: true,
    });
    expect(p.images.map((i) => i.url)).toEqual([
      "https://cdn.lumen.example/p/serum-1.jpg",
      "https://lumen.example/img/og.jpg",
      "https://cdn.lumen.example/products/serum-2.jpg",
    ]);
    expect(p.text).toContain("Fragrance-free and vegan");
  });

  it("checks that fact evidence is really on the page", () => {
    const { text } = parseProductPage(html, "https://lumen.example/serum");
    expect(evidenceOnPage("fragrance-free  and vegan", text)).toBe(true);
    expect(evidenceOnPage("clinically proven results", text)).toBe(false);
  });
});

describe("brand snapshot", () => {
  it("keeps only ad-relevant Brand DNA fields", () => {
    expect(
      brandSnapshot({
        brandName: "Lumen",
        voice: "Warm",
        logoUrl: "x",
        competitors: [{ name: "Y" }],
        audienceTags: ["a", 1],
      }),
    ).toEqual({ brandName: "Lumen", voice: "Warm", audienceTags: ["a"] });
  });
});

describe("storefront image sizes", () => {
  it("asks CDNs for a usable size instead of a thumbnail", async () => {
    const { largerImage } = await import("@/lib/ugc/product-page");
    expect(largerImage("https://x.com/cdn/shop/files/a.png?v=1&width=300")).toBe(
      "https://x.com/cdn/shop/files/a.png?v=1&width=1200",
    );
    expect(largerImage("https://x.com/a.jpg?w=2000")).toBe("https://x.com/a.jpg?w=2000");
  });
});
