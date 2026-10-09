import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  CAROUSEL_COLORWAYS,
  CAROUSEL_LOOKS,
  CAROUSEL_MOTIFS,
  carouselTheme,
  type CarouselDesign,
} from "@/lib/studio/carousel/design";
import { normalizeSlides } from "@/lib/studio/carousel/story";

// Set CAROUSEL_SMOKE_OUT=<dir> to fetch the real fonts and write every look to
// disk for a visual check. Without it the test never touches the network.
const OUT = process.env.CAROUSEL_SMOKE_OUT;

if (!OUT) {
  vi.doMock("@/server/safe-fetch", () => ({
    safeFetch: async () => ({ ok: false, status: 503, bytes: new Uint8Array(0), text: () => "" }),
  }));
}

const { carouselRenderable, renderCarouselSlides } = await import("./carousel-render.server");

const slides = normalizeSlides(
  [
    {
      heading: "Your cold brew goes flat by day three",
      emphasis: "day three",
      body: "For anyone who makes a batch on Sunday and pours it out on Wednesday.",
      kicker: "Home brewing",
    },
    {
      heading: "Flat coffee is an oxygen problem",
      body: "Every time the jar opens, air gets in and the bright notes go first. By the third day what is left tastes like cardboard.",
      kicker: "Why it happens",
    },
    {
      heading: "Grind coarser than you think",
      emphasis: "coarser",
      body: "Fine grounds keep extracting after you strain. Go one step coarser than French press and the bitterness stops building.",
      kicker: "Step 1",
    },
    {
      heading: "Strain it twice",
      body: "A metal sieve first, then paper. The paper catches the fines that turn a clean brew muddy overnight.",
      kicker: "Step 2",
    },
    {
      heading: "Store it full and sealed",
      emphasis: "full",
      body: "Use a bottle the batch fills to the neck. Less air in the bottle means more flavour on day five.",
      kicker: "Step 3",
    },
    {
      heading: "The three-step batch",
      body: "Grind one step coarser\nStrain through metal, then paper\nBottle it full and sealed",
      role: "recap",
      kicker: "Recap",
    },
    {
      heading: "Save this for your next Sunday batch",
      body: "Then tell us how day five tastes.",
    },
  ],
  7,
);

const palette = { primary: "#1f5f4a", secondary: "#f2b84b", accent: "#e4572e" };

describe("renderCarouselSlides", () => {
  it("draws one JPEG per slide at the carousel size", async () => {
    const design: CarouselDesign = { v: 1, look: "editorial", colorway: "light", motif: "orbit" };
    const theme = carouselTheme({ palette, fonts: { heading: "Fraunces" }, colorway: "light" });
    const images = await renderCarouselSlides({
      slides,
      design,
      theme,
      ratio: "4:5",
      brand: "Slow Pour Coffee",
      site: "slowpour.example",
    });
    expect(images).toHaveLength(slides.length);
    for (const image of images) {
      const meta = await sharp(image).metadata();
      expect(meta.format).toBe("jpeg");
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1350);
    }
  }, 60_000);

  it("draws the square size too", async () => {
    const theme = carouselTheme({ palette, colorway: "dark" });
    const [first] = await renderCarouselSlides({
      slides: slides.slice(0, 3),
      design: { v: 1, look: "bold", colorway: "dark", motif: "wave" },
      theme,
      ratio: "1:1",
      brand: "Slow Pour Coffee",
    });
    const meta = await sharp(first).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1080]);
  }, 60_000);

  it("draws connected slides that meet at every edge, and the last meets the first", async () => {
    const column = (image: Buffer, left: number) =>
      sharp(image).extract({ left, top: 0, width: 1, height: 1350 }).raw().toBuffer();
    // A stand-in for the generated background: different at every point across
    // its width, so a copy laid in the wrong place would show at an edge.
    const [pw, ph] = [1792, 1024];
    const pixels = Buffer.alloc(pw * ph * 3);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const at = (y * pw + x) * 3;
        pixels[at] = 128 + 120 * Math.sin(x / 70);
        pixels[at + 1] = (y * 255) / ph;
        pixels[at + 2] = (x * 255) / pw;
      }
    }
    const picture = await sharp(pixels, { raw: { width: pw, height: ph, channels: 3 } })
      .png()
      .toBuffer();
    const cases = CAROUSEL_MOTIFS.flatMap((motif, i) =>
      [null, picture].map((coverArt) => ({ motif, i, coverArt })),
    );
    for (const { motif, i, coverArt } of cases) {
      const colorway = CAROUSEL_COLORWAYS[i % CAROUSEL_COLORWAYS.length];
      const images = await renderCarouselSlides({
        // 3, 4 and 5 slides: odd and even counts both have to close the loop.
        slides: slides.slice(0, 3 + i),
        design: { v: 1, look: CAROUSEL_LOOKS[i], colorway, motif, flow: "seamless" },
        theme: carouselTheme({ palette, colorway }),
        ratio: "4:5",
        brand: "Slow Pour Coffee",
        coverArt,
      });
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        const strip = await sharp({
          create: {
            width: 360 * (images.length + 1),
            height: 450,
            channels: 3,
            background: "#888",
          },
        })
          .composite(
            await Promise.all(
              // The first slide again at the end, to see the loop close.
              [...images, images[0]].map(async (image, n) => ({
                input: await sharp(image).resize(360).toBuffer(),
                left: n * 360,
                top: 0,
              })),
            ),
          )
          .jpeg({ quality: 90 })
          .toBuffer();
        writeFileSync(join(OUT, `connected-${motif}${coverArt ? "-picture" : ""}.jpg`), strip);
      }
      for (let n = 0; n < images.length; n++) {
        const right = await column(images[n], 1079);
        const left = await column(images[(n + 1) % images.length], 0);
        let off = 0;
        for (let p = 0; p < right.length; p++) if (Math.abs(right[p] - left[p]) > 40) off++;
        // Two neighbouring columns of one picture: all but a few edge pixels agree.
        expect(
          off / right.length,
          `${motif}${coverArt ? " with a picture" : ""}: slide ${n + 1} into the next`,
        ).toBeLessThan(0.02);
      }
    }
  }, 240_000);

  it("refuses scripts its fonts cannot draw", () => {
    expect(carouselRenderable({ slides, brand: "Slow Pour Coffee" })).toBe(true);
    expect(
      carouselRenderable({
        slides: [{ heading: "قهوة باردة", body: "" }],
        brand: "Slow Pour",
      }),
    ).toBe(false);
  });

  it.runIf(!!OUT)(
    "writes every look to disk",
    async () => {
      mkdirSync(OUT!, { recursive: true });
      for (const [i, look] of CAROUSEL_LOOKS.entries()) {
        const colorway = CAROUSEL_COLORWAYS[i % CAROUSEL_COLORWAYS.length];
        const motif = CAROUSEL_MOTIFS[i % CAROUSEL_MOTIFS.length];
        const theme = carouselTheme({
          palette,
          fonts: { heading: i % 2 ? "Space Grotesk" : "Fraunces", body: "Inter" },
          colorway,
        });
        const images = await renderCarouselSlides({
          slides,
          design: { v: 1, look, colorway, motif },
          theme,
          ratio: i === 3 ? "1:1" : "4:5",
          brand: "Slow Pour Coffee",
          site: "slowpour.example",
        });
        const strip = await sharp({
          create: {
            width: 360 * images.length,
            height: i === 3 ? 360 : 450,
            channels: 3,
            background: "#888888",
          },
        })
          .composite(
            await Promise.all(
              images.map(async (image, n) => ({
                input: await sharp(image).resize(360).toBuffer(),
                left: n * 360,
                top: 0,
              })),
            ),
          )
          .jpeg({ quality: 85 })
          .toBuffer();
        writeFileSync(join(OUT!, `${look}-${colorway}-${motif}.jpg`), strip);
        writeFileSync(join(OUT!, `${look}-slide3.jpg`), images[2]);
      }
    },
    180_000,
  );
});
