// Bring a picture to an exact canvas size without cutting anything off: the
// whole picture, centred, over a soft blurred copy of itself. Used when a
// photo or a model image is too far off the post's shape to cover-cut (a tall
// phone photo for a 4:5 feed post, a square for a 9:16 Story). The picture
// itself is only scaled, never redrawn.
import "server-only";
import sharp from "sharp";

export async function fitWhole(input: Buffer, width: number, height: number): Promise<Buffer> {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const upright = await sharp(input, { failOn: "none" }).rotate().png().toBuffer();
  const backdrop = await sharp(upright)
    .resize(Math.max(8, Math.round(w / 8)), Math.max(8, Math.round(h / 8)), { fit: "cover" })
    .blur(4)
    .modulate({ brightness: 0.82 })
    .resize(w, h, { fit: "fill" })
    .png()
    .toBuffer();
  const whole = await sharp(upright)
    .resize(w, h, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  return sharp(backdrop)
    .composite([
      {
        input: whole.data,
        left: Math.max(0, Math.round((w - whole.info.width) / 2)),
        top: Math.max(0, Math.round((h - whole.info.height) / 2)),
      },
    ])
    .removeAlpha()
    .png()
    .toBuffer();
}
