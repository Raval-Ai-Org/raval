#!/usr/bin/env node
// Staff tool: make the picture on each Creator video format card
// (src/lib/ugc/formats/formats.ts), shown in the format picker.
//
//   node scripts/generate-ugc-format-thumbs.mjs                    # every format without one
//   node scripts/generate-ugc-format-thumbs.mjs subway-interview   # these, even if they exist
//
// The prompt is built only from the format's own words (show, camera, first
// place, look) and asks for fictional people, no product, no words and no
// logos. One paid image each (OpenRouter, IMAGE_MODEL_DEFAULT, data collection
// denied), saved as public/ugc-formats/<id>.jpg (576x1024), then
// src/lib/ugc/format-thumbs.ts is rewritten to list the pictures on disk.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import dotenv from "dotenv";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env.local") });
dotenv.config({ path: join(root, ".env") });

const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { UGC_FORMATS } = await jiti.import(join(root, "src/lib/ugc/formats/formats.ts"));

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(1);
}
const model = process.env.IMAGE_MODEL_DEFAULT?.trim() || "openai/gpt-image-2.5-flare";
const outDir = join(root, "public", "ugc-formats");
mkdirSync(outDir, { recursive: true });

const asked = process.argv.slice(2);
const ids = asked.length
  ? asked
  : UGC_FORMATS.map((f) => f.id).filter((id) => !existsSync(join(outDir, `${id}.jpg`)));

// Fictional looks, rotated per format so the grid isn't one face thirty times.
const LOOKS = [
  "a man in his late 20s, dark brown skin, short twists, grey crewneck",
  "a woman in her 40s, East Asian, shoulder-length black hair, denim shirt",
  "a man in his 50s, white, salt-and-pepper beard, flannel shirt",
  "a woman in her early 20s, South Asian, long wavy hair, oversized hoodie",
  "a man in his 30s, Latino, buzz cut, black puffer vest",
  "a woman in her 60s, Black, short grey natural hair, cream cardigan",
  "a woman in her 30s, white, red hair in a low bun, striped long-sleeve top",
  "a man in his early 20s, Middle Eastern, curly hair, varsity jacket",
  "a woman in her late 20s, Southeast Asian, straight bob, plain white tee",
  "a man in his 40s, South Asian, neat short hair, navy quarter-zip",
  "a woman in her 30s, Black, braids tied up, green utility jacket",
  "a man in his 30s, East Asian, round glasses, beige overshirt",
];

function promptFor(f) {
  const place = f.places[0];
  const at = UGC_FORMATS.indexOf(f);
  const cast = f.roles.length
    ? f.roles
        .map(
          (r, i) =>
            `${r.title.toLowerCase()} (${r.position}) is ${LOOKS[(at * 5 + i * 7) % LOOKS.length]}: ${r.behaviour}`,
        )
        .join("; ")
    : "only hands in frame";
  return [
    `A single candid still frame from a real vertical smartphone video: ${f.show}. One photo, never a collage or grid${f.edit === "split-open" || f.id === "before-after" ? " (a split screen down the middle is fine)" : ""}.`,
    `${f.camera}.`,
    f.beats[0] ? `The moment shown: ${f.beats[0].shot}; ${f.beats[0].action}.` : "",
    place ? `${place.set}. ${place.light}.` : "",
    `${f.look}.`,
    `People: ${cast}. Original, fictional everyday people, never a real or famous person, caught mid-moment, not posing for the camera.`,
    "Looks like raw social-media footage: natural skin texture, slight phone-camera softness, real clutter, not cinematic, not an advertisement, not a stock photo.",
    "No words, captions, subtitles, logos, brand names, watermarks or user interface anywhere in the picture.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function request(f, ratio) {
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Mellox format thumbnails",
    },
    body: JSON.stringify({
      model,
      prompt: promptFor(f),
      aspect_ratio: ratio,
      quality: "medium",
      resolution: "1K",
      background: "opaque",
      output_format: "png",
      n: 1,
      provider: { data_collection: "deny" },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function generate(f) {
  let json;
  try {
    json = await request(f, "9:16");
  } catch {
    // Some image models stop at 2:3; the crop keeps the middle.
    json = await request(f, "2:3");
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image in the answer.");
  const jpg = await sharp(Buffer.from(b64, "base64"))
    .resize({ width: 576, height: 1024, fit: "cover" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(outDir, `${f.id}.jpg`), jpg);
  return Number(json?.usage?.cost) || 0;
}

let spent = 0;
for (const id of ids) {
  const f = UGC_FORMATS.find((x) => x.id === id);
  if (!f) {
    console.warn(`skip ${id}: not in formats.ts`);
    continue;
  }
  try {
    const cost = await generate(f);
    spent += cost;
    console.log(`ok   ${id}${cost ? `  $${cost.toFixed(4)}` : ""}`);
  } catch (error) {
    console.error(`fail ${id}: ${error.message}`);
  }
}

// The picture list the app reads: only files that really exist.
const known = new Set(UGC_FORMATS.map((f) => f.id));
const thumbs = readdirSync(outDir)
  .filter((f) => f.endsWith(".jpg") && known.has(f.slice(0, -4)))
  .map((f) => f.slice(0, -4))
  .sort();
writeFileSync(
  join(root, "src/lib/ugc/format-thumbs.ts"),
  `// Written by scripts/generate-ugc-format-thumbs.mjs: the Creator video formats
// that have a picture at public/ugc-formats/<id>.jpg. Don't edit by hand.

export const FORMAT_THUMB_IDS: readonly string[] = ${JSON.stringify(thumbs, null, 2)};

export function formatThumbPath(id: string): string | null {
  return FORMAT_THUMB_IDS.includes(id) ? \`/ugc-formats/\${id}.jpg\` : null;
}
`,
);
console.log(`\n${thumbs.length} format pictures on disk. Spent about $${spent.toFixed(2)}.`);
