// The device a website reel plays in, drawn by code: the brand's background
// with one soft glow of its accent, a phone or browser around the screen and
// a contact shadow. The screen is cut out, so the scrolling page shows through
// (ffmpeg.server.ts siteScroll). No model draws anything here.
import "server-only";
import sharp from "sharp";
import { siteFrame, type SiteDevice } from "@/lib/studio/site-reel";

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Background and accent from the brand's colours; plain dark when there are none. */
export function siteColours(colours: string[]): { background: string; accent: string } {
  const valid = colours.filter((c) => HEX.test(c));
  // A near-white or near-black brand colour is a background; a coloured one is the accent.
  const background = valid.find((c) => luminance(c) < 0.18) ?? "#111318";
  const accent = valid.find((c) => c !== background && luminance(c) >= 0.18) ?? "#ffffff";
  return { background, accent };
}

export async function siteFramePng(args: {
  canvas: { width: number; height: number };
  device: SiteDevice;
  colours: string[];
}): Promise<Buffer> {
  const { width, height } = args.canvas;
  const { device, screen, radius, bar } = siteFrame(args.canvas, args.device);
  const { background, accent } = siteColours(args.colours);
  const phone = args.device === "phone";
  const screenRadius = phone ? Math.round(radius * 0.8) : radius;
  const dot = Math.round(bar * 0.16);
  const dots = phone
    ? ""
    : [0, 1, 2]
        .map(
          (i) =>
            `<circle cx="${device.x + bar * 0.6 + i * dot * 3.2}" cy="${device.y + bar / 2}" r="${dot}" fill="#ffffff" fill-opacity="${0.5 - i * 0.12}"/>`,
        )
        .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="glow" cx="0.85" cy="0.12" r="0.75">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feGaussianBlur stdDeviation="${Math.round(width * 0.025)}"/>
    </filter>
    <mask id="hole">
      <rect width="${width}" height="${height}" fill="#ffffff"/>
      <rect x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" rx="${screenRadius}" fill="#000000"/>
    </mask>
  </defs>
  <g mask="url(#hole)">
    <rect width="${width}" height="${height}" fill="${background}"/>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>
    <ellipse cx="${device.x + device.w / 2}" cy="${device.y + device.h}" rx="${device.w * 0.42}" ry="${Math.round(height * 0.025)}" fill="#000000" fill-opacity="0.45" filter="url(#shadow)"/>
    <rect x="${device.x}" y="${device.y}" width="${device.w}" height="${device.h}" rx="${radius}" fill="#0b0c0f"/>
    <rect x="${device.x + 0.5}" y="${device.y + 0.5}" width="${device.w - 1}" height="${device.h - 1}" rx="${radius}" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>
    ${dots}
  </g>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
