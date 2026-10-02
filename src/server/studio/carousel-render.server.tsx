// carousel-render.server.tsx — turns carousel slides into the images that get
// published. It draws the same SlideArt element the Studio preview shows
// (next/og: satori + resvg), then encodes JPEG, which every social network
// accepts. No model call and no provider: rendering costs nothing.
//
// Fonts come from Google Fonts for catalogue families only (a fixed host; the
// family is matched against FONT_CATALOG first), cached for the life of the
// process. If they can't be fetched the renderer's built-in face is used, so a
// slide is never lost to a font.
import "server-only";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { catalogFont } from "@/lib/brand-kit/fonts";
import { SlideArt } from "@/lib/studio/carousel/SlideArt";
import {
  canRenderText,
  carouselCanvas,
  type CarouselDesign,
  type CarouselTheme,
} from "@/lib/studio/carousel/design";
import type { CarouselSlide } from "@/lib/studio/jobs";
import { safeFetch } from "@/server/safe-fetch";

type FontFace = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

// An old Safari gets plain TrueType files; satori can't read woff2.
const TTF_UA =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
const FONT_MAX_BYTES = 3 * 1024 * 1024;
const fontCache = new Map<string, Promise<FontFace[]>>();

async function fetchFamily(family: string): Promise<FontFace[]> {
  const known = catalogFont(family);
  if (!known) return [];
  const single = known.category === "display" || known.category === "handwriting";
  const name = known.family.replace(/ /g, "+");
  const css = await safeFetch(
    `https://fonts.googleapis.com/css2?family=${name}${single ? "" : ":wght@400;700"}`,
    { headers: { "User-Agent": TTF_UA }, timeoutMs: 8_000, maxBytes: 200_000 },
  );
  if (!css.ok) return [];
  const faces: FontFace[] = [];
  const blocks = css.text().match(/@font-face\s*{[^}]*}/g) ?? [];
  for (const block of blocks) {
    const url = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.(?:ttf|otf))\)/)?.[1];
    if (!url) continue;
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400) >= 600 ? 700 : 400;
    if (faces.some((f) => f.weight === weight)) continue;
    const file = await safeFetch(url, {
      timeoutMs: 10_000,
      maxBytes: FONT_MAX_BYTES,
      onOverflow: "error",
    });
    if (!file.ok || !file.bytes.byteLength) continue;
    const data = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;
    faces.push({ name: known.family, data, weight, style: "normal" });
  }
  // A one-weight face is also the answer when bold is asked for.
  if (faces.length === 1) {
    faces.push({ ...faces[0], weight: faces[0].weight === 400 ? 700 : 400 });
  }
  return faces;
}

function loadFamily(family: string): Promise<FontFace[]> {
  const key = family.toLowerCase();
  let hit = fontCache.get(key);
  if (!hit) {
    hit = fetchFamily(family).catch((error) => {
      console.warn(
        "[carousel] font unavailable",
        family,
        error instanceof Error ? error.message : error,
      );
      return [];
    });
    fontCache.set(key, hit);
    // A failed load is retried on the next carousel, not remembered forever.
    void hit.then((faces) => {
      if (!faces.length) fontCache.delete(key);
    });
  }
  return hit;
}

export type CarouselRenderInput = {
  slides: CarouselSlide[];
  design: CarouselDesign;
  theme: CarouselTheme;
  ratio: string | null | undefined;
  brand: string;
  site?: string | null;
  /** The generated cover picture's bytes, if there is one. */
  coverArt?: Buffer | null;
};

/** Slides this renderer can draw faithfully (see canRenderText). */
export function carouselRenderable(input: Pick<CarouselRenderInput, "slides" | "brand">): boolean {
  return canRenderText(
    [input.brand, ...input.slides.flatMap((s) => [s.heading, s.body, s.kicker ?? ""])].join(" "),
  );
}

/** One JPEG per slide, in order. Throws if a slide can't be drawn. */
export async function renderCarouselSlides(input: CarouselRenderInput): Promise<Buffer[]> {
  const { width, height } = carouselCanvas(input.ratio);
  const families = [...new Set([input.theme.headingFont, input.theme.bodyFont])];
  const fonts = (await Promise.all(families.map(loadFamily))).flat();

  let coverImage: string | null = null;
  if (input.coverArt?.length) {
    try {
      const fitted = await sharp(input.coverArt)
        .resize(width, height, { fit: "cover" })
        .jpeg({ quality: 88 })
        .toBuffer();
      coverImage = `data:image/jpeg;base64,${fitted.toString("base64")}`;
    } catch (error) {
      console.warn("[carousel] cover picture unreadable, drawing without it", error);
    }
  }

  const out: Buffer[] = [];
  for (let index = 0; index < input.slides.length; index++) {
    const image = new ImageResponse(
      <SlideArt
        slides={input.slides}
        index={index}
        design={input.design}
        theme={input.theme}
        width={width}
        height={height}
        brand={input.brand}
        site={input.site}
        coverImage={coverImage}
      />,
      { width, height, ...(fonts.length ? { fonts } : {}) },
    );
    const png = Buffer.from(await image.arrayBuffer());
    out.push(await sharp(png).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
  }
  return out;
}
