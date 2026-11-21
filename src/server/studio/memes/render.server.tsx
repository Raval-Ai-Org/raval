import "server-only";
// Draws a meme's words on its picture, the way memegen does: bold condensed
// capitals, white with a black outline, fitted to each of the template's text
// boxes. The picture is either the real template (classic, no image cost) or
// the image model's remix of it in the brand's world. Fails open: null means
// "make it the original way" (text the font can't draw, a missing picture).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { fitMemeText, memeBoxRects } from "@/lib/studio/memes/select";
import type { MemeTemplate } from "@/lib/studio/memes/types";

type Face = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
let anton: Promise<Face[]> | null = null;
/** Anton ships with the app (public/fonts, OFL), so a meme never waits on a font host. */
function memeFont(): Promise<Face[]> {
  anton ??= readFile(join(process.cwd(), "public", "fonts", "Anton-Regular.ttf"))
    .then((buf) => {
      const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      return [
        { name: FONT, data, weight: 400 as const, style: "normal" as const },
        { name: FONT, data, weight: 700 as const, style: "normal" as const },
      ];
    })
    .catch((error) => {
      anton = null;
      console.warn("[meme] font missing", error instanceof Error ? error.message : error);
      return [];
    });
  return anton;
}

const FONT = "Anton";
/** Anton draws Latin script only; anything else is made the original way. */
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u;

export function memeTextDrawable(lines: readonly string[]): boolean {
  return lines.every((l) => LATIN.test(l));
}

/** The template's own picture from public/memes (null when missing). */
export async function memeTemplatePicture(template: MemeTemplate): Promise<Buffer | null> {
  try {
    return await readFile(join(process.cwd(), "public", "memes", `${template.id}.jpg`));
  } catch {
    return null;
  }
}

function outline(px: number): string {
  const s = Math.max(1, Math.round(px));
  const out: string[] = [];
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ])
    out.push(`${dx * s}px ${dy * s}px 0 #000`);
  return out.join(", ");
}

/**
 * The picture with the words drawn in the template's boxes, as JPEG, at the
 * picture's own size (at most 1080 wide). Null when it can't be drawn.
 */
export async function drawMeme(args: {
  picture: Buffer;
  template: MemeTemplate;
  lines: readonly string[];
}): Promise<Buffer | null> {
  if (!memeTextDrawable(args.lines)) return null;
  try {
    const resized = await sharp(args.picture, { failOn: "none" })
      .rotate()
      .resize({ width: 1080, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    const width = resized.info.width;
    const height = resized.info.height;
    const fonts = await memeFont();
    if (!fonts.length) return null;
    const rects = memeBoxRects(args.template, width, height);
    const src = `data:image/jpeg;base64,${resized.data.toString("base64")}`;
    const image = new ImageResponse(
      <div style={{ display: "flex", position: "relative", width, height }}>
        <img
          src={src}
          width={width}
          height={height}
          alt=""
          style={{ position: "absolute", left: 0, top: 0 }}
        />
        {rects.map((rect, i) => {
          const raw = (args.lines[i] ?? "").trim();
          if (!raw) return null;
          const text = rect.upper ? raw.toUpperCase() : raw;
          const fit = fitMemeText(text, rect);
          const fill = rect.color === "black" ? "#000" : "#fff";
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems:
                  rect.align === "left"
                    ? "flex-start"
                    : rect.align === "right"
                      ? "flex-end"
                      : "center",
              }}
            >
              {fit.lines.map((line, k) => (
                <div
                  key={k}
                  style={{
                    fontFamily: FONT,
                    fontSize: fit.size,
                    lineHeight: 1.1,
                    color: fill,
                    ...(fill === "#fff"
                      ? {
                          WebkitTextStroke: `${Math.max(2, Math.round(fit.size / 9))}px #000`,
                          textShadow: outline(fit.size / 16),
                        }
                      : {}),
                    textAlign: rect.align as "left" | "center" | "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          );
        })}
      </div>,
      { width, height, fonts },
    );
    const png = Buffer.from(await image.arrayBuffer());
    return await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  } catch (error) {
    console.warn("[meme] could not draw the words", error instanceof Error ? error.message : error);
    return null;
  }
}
