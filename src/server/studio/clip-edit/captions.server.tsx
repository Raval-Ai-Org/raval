// Caption pictures for a branded video: each cue drawn by CaptionArt
// (next/og), with the brand's heading font when the catalogue has it. No
// model call. Scripts the renderer's fonts can't draw are refused up front
// (canRenderText), so a caption is never shown as empty boxes.
import "server-only";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { CaptionArt } from "@/lib/studio/CaptionArt";
import type { CaptionColours, Cue } from "@/lib/studio/captions";
import { canRenderText } from "@/lib/studio/carousel/design";
import { loadFonts } from "../carousel-render.server";

export function captionsDrawable(cues: Cue[]): boolean {
  return canRenderText(cues.flatMap((c) => c.lines.flat()).join(" "));
}

/** One transparent PNG per cue, all the band's size, plus a clear one for the gaps. */
export async function renderCaptionImages(args: {
  dir: string;
  cues: Cue[];
  colours: CaptionColours;
  box: { width: number; height: number; fontSize: number };
  font?: string | null;
}): Promise<{ blank: string; images: string[] }> {
  const { width, height, fontSize } = args.box;
  const fonts = args.font ? await loadFonts([args.font]) : [];
  const fontFamily = fonts[0]?.name;
  const blank = join(args.dir, "caption-blank.png");
  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toFile(blank);
  const images: string[] = [];
  for (const [index, cue] of args.cues.entries()) {
    const image = new ImageResponse(
      <CaptionArt
        cue={cue}
        colours={args.colours}
        width={width}
        height={height}
        fontSize={fontSize}
        fontFamily={fontFamily}
      />,
      { width, height, ...(fonts.length ? { fonts } : {}) },
    );
    const file = join(args.dir, `caption-${index}.png`);
    await writeFile(file, Buffer.from(await image.arrayBuffer()));
    images.push(file);
  }
  return { blank, images };
}
