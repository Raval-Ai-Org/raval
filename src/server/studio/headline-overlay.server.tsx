import "server-only";
// Sets a headline on a word-free picture (Round 9, flag `headline`): the
// calmer of the top and bottom bands, a soft scrim for contrast, the brand's
// own font. Used once when the picture is made and again on every free
// "Edit text". Throws when the words can't be drawn; callers keep the plain
// picture (or refuse the edit) instead.
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { canRenderText } from "@/lib/studio/carousel/design";
import {
  overlayFontSize,
  overlayPlacement,
  type BandRead,
  type HeadlineOverlay,
} from "@/lib/studio/headline-overlay";
import { loadFonts } from "@/server/studio/carousel-render.server";

const WIDTH = 1080;
const MEASURE = 240;

/** How busy (Laplacian spread) and how light one band of the picture is. */
async function readBand(art: Buffer, top: boolean): Promise<BandRead> {
  const meta = await sharp(art).metadata();
  const w = meta.width ?? MEASURE;
  const h = meta.height ?? MEASURE;
  const bandH = Math.max(1, Math.round(h * 0.34));
  const region = { left: 0, top: top ? 0 : h - bandH, width: w, height: bandH };
  const height = Math.max(1, Math.round((MEASURE * bandH) / w));
  const grey = sharp(art).extract(region).greyscale().resize(MEASURE, height, { fit: "fill" });
  const [edges, plain] = await Promise.all([
    grey
      .clone()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
      .raw()
      .toBuffer(),
    grey.clone().raw().toBuffer(),
  ]);
  let sum = 0;
  let sq = 0;
  for (const v of edges) {
    sum += v;
    sq += v * v;
  }
  const n = edges.length || 1;
  const spread = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
  let light = 0;
  for (const v of plain) light += v;
  return { busy: Math.min(1, spread / 40), light: light / (plain.length || 1) / 255 };
}

export async function drawHeadlineOverlay(args: {
  art: Buffer;
  overlay: HeadlineOverlay;
}): Promise<Buffer> {
  const { headline, font } = args.overlay;
  if (!canRenderText(headline))
    throw new Error("This headline needs a font the editor can't draw yet.");
  const meta = await sharp(args.art).metadata();
  const height = Math.round((WIDTH * (meta.height ?? WIDTH)) / (meta.width ?? WIDTH));
  const [top, bottom] = await Promise.all([readBand(args.art, true), readBand(args.art, false)]);
  const place = overlayPlacement(top, bottom);
  const fitted = await sharp(args.art)
    .resize(WIDTH, height, { fit: "cover" })
    .jpeg({ quality: 90 })
    .toBuffer();
  const fonts = await loadFonts([font]);
  const family = fonts.some((f) => f.name === font) ? font : undefined;
  const size = overlayFontSize(headline, WIDTH);
  const ink = place.ink === "light" ? "#ffffff" : "#111111";
  const shade = place.ink === "light" ? "0,0,0" : "255,255,255";
  const scrim = `linear-gradient(${place.at === "top" ? "180deg" : "0deg"}, rgba(${shade},0.58) 0%, rgba(${shade},0.28) 55%, rgba(${shade},0) 100%)`;
  const image = new ImageResponse(
    <div style={{ display: "flex", position: "relative", width: WIDTH, height }}>
      <img
        src={`data:image/jpeg;base64,${fitted.toString("base64")}`}
        alt=""
        style={{ position: "absolute", left: 0, top: 0, width: WIDTH, height }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          [place.at]: 0,
          height: Math.round(height * 0.42),
          backgroundImage: scrim,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: Math.round(WIDTH * 0.07),
          right: Math.round(WIDTH * 0.07),
          [place.at]: Math.round(height * 0.07),
          display: "flex",
          justifyContent: "center",
          textAlign: "center",
          color: ink,
          ...(family ? { fontFamily: family } : {}),
          fontSize: size,
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: -size * 0.015,
        }}
      >
        {headline}
      </div>
    </div>,
    { width: WIDTH, height, ...(fonts.length ? { fonts } : {}) },
  );
  return sharp(Buffer.from(await image.arrayBuffer()))
    .jpeg({ quality: 92 })
    .toBuffer();
}
