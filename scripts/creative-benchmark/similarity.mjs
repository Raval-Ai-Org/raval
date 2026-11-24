// similarity.mjs — free, local check that a brand's posts don't all look the
// same (Round 9 uniqueness, ADR-0053). For each arm it compares every pair of
// pictures made for the same brand: a perceptual hash (dHash, layout) and a
// colour histogram. Lower similarity means more varied posts.
//   node scripts/creative-benchmark/similarity.mjs .live-out/blind/<run>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const dir = process.argv[2];
if (!dir) throw new Error("usage: similarity.mjs <run dir>");
const { key } = JSON.parse(readFileSync(path.join(dir, "key.json"), "utf8"));
const judged = JSON.parse(readFileSync(path.join(dir, "judge.json"), "utf8"));

async function dhash(file) {
  const px = await sharp(file).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return bits;
}

async function histogram(file) {
  const px = await sharp(file).resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const bins = new Array(64).fill(0);
  for (let i = 0; i < px.length; i += 3)
    bins[((px[i] >> 6) << 4) | ((px[i + 1] >> 6) << 2) | (px[i + 2] >> 6)]++;
  const total = px.length / 3;
  return bins.map((b) => b / total);
}

const hamming = (a, b) => [...a].filter((c, i) => c !== b[i]).length / a.length;
const overlap = (a, b) => a.reduce((s, v, i) => s + Math.min(v, b[i]), 0);

// Group pictures by arm and brand (the brand is the case id's brand prefix in key order).
const groups = {};
for (const row of judged) {
  const k = key[row.id];
  if (!k || k.control) continue;
  const brand = row.id.startsWith("svc-")
    ? row.id.split("-").slice(0, 2).join("-")
    : row.id.split("-")[0];
  for (const [arm, file] of [
    [k.left, row.leftFile],
    [k.right, row.rightFile],
  ]) {
    ((groups[arm] ??= {})[brand] ??= []).push(path.join(dir, "img", file));
  }
}

const out = {};
for (const [arm, brands] of Object.entries(groups)) {
  const layout = [];
  const colour = [];
  for (const files of Object.values(brands)) {
    if (files.length < 2) continue;
    const feats = await Promise.all(
      files.map(async (f) => ({ h: await dhash(f), c: await histogram(f) })),
    );
    for (let i = 0; i < feats.length; i++)
      for (let j = i + 1; j < feats.length; j++) {
        layout.push(1 - hamming(feats[i].h, feats[j].h));
        colour.push(overlap(feats[i].c, feats[j].c));
      }
  }
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  out[arm] = {
    pairs: layout.length,
    layoutSimilarity: +avg(layout).toFixed(3),
    colourSimilarity: +avg(colour).toFixed(3),
  };
}
writeFileSync(path.join(dir, "similarity.json"), JSON.stringify(out, null, 2));
console.log(out);
