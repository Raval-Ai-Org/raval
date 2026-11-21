// One-off: cut Mox's white studio background out of a render so it sits on
// any surface (dark theme, the gradient backdrop). Flood-fills near-white
// pixels from the image edges, so the white face inside the outline is kept,
// then softens the one-pixel rim.
//
//   node scripts/mox-cutout.mjs public/brand/mox/visor-src.webp public/brand/mox/visor.webp

import sharp from "sharp";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/mox-cutout.mjs <in> <out>");
  process.exit(1);
}

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const px = (x, y) => (y * w + x) * 4;
const whiteness = (i) => Math.min(data[i], data[i + 1], data[i + 2]);
const BG = 246;

const bg = new Uint8Array(w * h);
const stack = [];
for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= w || y >= h) continue;
  const k = y * w + x;
  if (bg[k] || whiteness(k * 4) < BG) continue;
  bg[k] = 1;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const k = y * w + x;
    const i = px(x, y);
    if (bg[k]) {
      data[i + 3] = 0;
      continue;
    }
    // A rim pixel next to the background keeps only its non-white part.
    const nearBg =
      (x > 0 && bg[k - 1]) || (x < w - 1 && bg[k + 1]) || (y > 0 && bg[k - w]) || (y < h - 1 && bg[k + w]);
    if (nearBg) {
      const t = (255 - whiteness(i)) / (255 - 200);
      data[i + 3] = Math.round(255 * Math.max(0.35, Math.min(1, t)));
    }
  }
}

await sharp(data, { raw: { width: w, height: h, channels: 4 } })
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(output);
console.log(`wrote ${output} (${w}×${h})`);
