import "server-only";
import sharp from "sharp";
import type { AspectRatio } from "@/lib/studio/aspect";
import type { StudioJobOutput } from "@/lib/studio/jobs";

const OVERLAY_REQUEST =
  /\b(?:add|put|place|overlay|write|include)\b.{0,50}\b(?:text|headline|title|caption|badge)\b/i;
const LOGO_REQUEST = /\b(?:add|put|place|overlay|include|use)\b.{0,40}\b(?:our |the )?logo\b/i;

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

function quotedCopy(brief: string): string | null {
  const match = brief.match(/[“"]([^”"]{2,80})[”"]/);
  return match?.[1]?.trim() || null;
}

/** Only add copy when the person asked for copy on the photo. */
export function sourcePhotoOverlayText(brief: string, output: StudioJobOutput): string | null {
  if (!OVERLAY_REQUEST.test(brief)) return null;
  return (
    [quotedCopy(brief), output.onImageText, output.ads?.[0]?.headline, output.title]
      .find((value) => value?.trim())
      ?.trim() ?? null
  );
}

export function sourcePhotoWantsLogo(brief: string): boolean {
  return LOGO_REQUEST.test(brief);
}

function dimensions(ratio: AspectRatio): { width: number; height: number } {
  if (ratio === "9:16") return { width: 1080, height: 1920 };
  if (ratio === "16:9") return { width: 1920, height: 1080 };
  if (ratio === "4:5") return { width: 1080, height: 1350 };
  if (ratio === "3:4") return { width: 1080, height: 1440 };
  if (ratio === "4:3") return { width: 1440, height: 1080 };
  return { width: 1080, height: 1080 };
}

function lines(text: string, max = 26): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (line && `${line} ${word}`.length > max) {
      result.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) result.push(line);
  return result.slice(0, 3);
}

/**
 * Builds a social canvas without synthesizing or repainting the customer photo.
 * The complete source is fitted on top of a blurred extension; only the requested
 * text layer is drawn over it.
 */
export async function composeSourcePhoto(args: {
  bytes: Buffer;
  ratio: AspectRatio;
  text: string;
}): Promise<Buffer> {
  const { width, height } = dimensions(args.ratio);
  const source = sharp(args.bytes, { limitInputPixels: 40_000_000 }).rotate();
  const [background, foreground] = await Promise.all([
    source
      .clone()
      .resize(width, height, { fit: "cover" })
      .blur(28)
      .modulate({ brightness: 0.58, saturation: 0.8 })
      .png()
      .toBuffer(),
    source
      .clone()
      .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  ]);
  const copy = lines(args.text.slice(0, 120));
  const fontSize = Math.max(42, Math.min(72, Math.floor(width / 15)));
  const lineHeight = Math.round(fontSize * 1.12);
  const panelHeight = Math.max(190, copy.length * lineHeight + 92);
  const startY = height - panelHeight + 48;
  const text = copy
    .map(
      (line, index) =>
        `<text x="64" y="${startY + index * lineHeight}" fill="#ffffff" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join("");
  const overlay =
    Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.86"/></linearGradient></defs>
    <rect x="0" y="${height - Math.round(panelHeight * 1.45)}" width="${width}" height="${Math.round(panelHeight * 1.45)}" fill="url(#fade)"/>
    ${text}
  </svg>`);
  return sharp(background)
    .composite([{ input: foreground }, { input: overlay }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
