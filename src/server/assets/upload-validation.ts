/** Validate the container signature before persisting user supplied media. */
export function matchesMediaType(bytes: Uint8Array, type: string): boolean {
  const starts = (signature: number[]) => signature.every((v, i) => bytes[i] === v);
  const ascii = (offset: number, value: string) =>
    [...value].every((v, i) => bytes[offset + i] === v.charCodeAt(0));
  if (type === "image/png") return starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (type === "image/jpeg") return starts([255, 216, 255]);
  if (type === "image/gif") return ascii(0, "GIF87a") || ascii(0, "GIF89a");
  if (type === "image/webp") return ascii(0, "RIFF") && ascii(8, "WEBP");
  if (type === "image/avif" || type === "image/heic" || type === "image/heif")
    return bytes.length >= 12 && ascii(4, "ftyp");
  if (type === "image/tiff") return ascii(0, "II*\0") || ascii(0, "MM\0*");
  if (type === "video/webm") return starts([26, 69, 223, 163]);
  if (type === "video/mp4" || type === "video/quicktime")
    return (
      bytes.length >= 12 && ["ftyp", "moov", "mdat", "wide", "free"].some((atom) => ascii(4, atom))
    );
  return false;
}
