// Identify an uploaded product photo from its bytes (never the file name or
// the browser's declared type) and read its pixel size, so only images the
// video models accept are stored: PNG, JPEG or WebP, 300–6000px per side,
// aspect ratio between 0.4 and 2.5.

export type ImageProbe = { mime: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number };

export function probeImage(bytes: Uint8Array): ImageProbe | null {
  const b = bytes;
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u32be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u24le = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

  // PNG: signature + IHDR
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", width: u32be(16), height: u32be(20) };
  }
  // JPEG: walk segments to a SOFn marker
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const len = u16be(o + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { mime: "image/jpeg", width: u16be(o + 7), height: u16be(o + 5) };
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (
    b.length >= 30 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  ) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 ") return { mime: "image/webp", width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { mime: "image/webp", width: u24le(24) + 1, height: u24le(27) + 1 };
  }
  return null;
}

export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

/** Null when acceptable, otherwise a message for the user. */
export function referenceImageProblem(probe: ImageProbe | null, byteLength: number): string | null {
  if (byteLength > MAX_REFERENCE_BYTES) return "Images must be 10 MB or smaller.";
  if (!probe) return "Use a PNG, JPEG or WebP image.";
  const { width, height } = probe;
  if (Math.min(width, height) < 300) return "Images must be at least 300px on each side.";
  if (Math.max(width, height) > 6000) return "Images must be at most 6000px on each side.";
  const ratio = width / height;
  if (ratio < 0.4 || ratio > 2.5) return "That image is too tall or too wide. Crop it closer to square.";
  return null;
}
