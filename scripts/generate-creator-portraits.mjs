#!/usr/bin/env node
// Staff tool: make the photo of each ready-made creator (src/lib/ugc/creators.ts).
//
//   node scripts/generate-creator-portraits.mjs            # the default 12 missing ones
//   node scripts/generate-creator-portraits.mjs maya noah  # these, even if they exist
//
// Every creator is an original, fictional person written in creators.ts: the
// prompt is built only from that description and never names or copies a real
// person. One paid image each (OpenRouter, IMAGE_MODEL_DEFAULT, data
// collection denied), saved as public/creators/<id>.jpg, then
// src/lib/ugc/creator-photos.ts is rewritten to list the photos on disk.
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
const { STOCK_CREATORS, creatorPhotoPrompt } = await jiti.import(
  join(root, "src/lib/ugc/creators.ts"),
);
const { SETTINGS } = await jiti.import(join(root, "src/lib/ugc/options.ts"));

const DEFAULT_IDS = [
  "maya",
  "jordan",
  "priya",
  "lucas",
  "amara",
  "daniel",
  "sofia",
  "kenji",
  "leila",
  "marcus",
  "elena",
  "noah",
];

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(1);
}
const model = process.env.IMAGE_MODEL_DEFAULT?.trim() || "openai/gpt-image-2.5-flare";
const outDir = join(root, "public", "creators");
mkdirSync(outDir, { recursive: true });

const asked = process.argv.slice(2);
const ids = asked.length
  ? asked
  : DEFAULT_IDS.filter((id) => !existsSync(join(outDir, `${id}.jpg`)));

function promptFor(c) {
  return creatorPhotoPrompt({
    gender: c.gender,
    age: c.age,
    look: c.look,
    place: SETTINGS.find((x) => x.id === c.setting)?.prompt || "",
  });
}

async function generate(c) {
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Mellox creator portraits",
    },
    body: JSON.stringify({
      model,
      prompt: promptFor(c),
      aspect_ratio: "3:4",
      quality: "high",
      resolution: "1K",
      background: "opaque",
      output_format: "png",
      n: 1,
      provider: { data_collection: "deny" },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image in the answer.");
  const jpg = await sharp(Buffer.from(b64, "base64"))
    .resize({ width: 768, height: 1024, fit: "cover" })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(outDir, `${c.id}.jpg`), jpg);
  return Number(json?.usage?.cost) || 0;
}

let spent = 0;
for (const id of ids) {
  const c = STOCK_CREATORS.find((x) => x.id === id);
  if (!c) {
    console.warn(`skip ${id}: not in creators.ts`);
    continue;
  }
  try {
    const cost = await generate(c);
    spent += cost;
    console.log(`ok   ${id}${cost ? `  $${cost.toFixed(4)}` : ""}`);
  } catch (error) {
    console.error(`fail ${id}: ${error.message}`);
  }
}

// The photo list the app reads: only files that really exist.
const known = new Set(STOCK_CREATORS.map((c) => c.id));
const photos = readdirSync(outDir)
  .filter((f) => f.endsWith(".jpg") && known.has(f.slice(0, -4)))
  .map((f) => f.slice(0, -4))
  .sort();
writeFileSync(
  join(root, "src/lib/ugc/creator-photos.ts"),
  `// Written by scripts/generate-creator-portraits.mjs: the ready-made creators
// that have a photo at public/creators/<id>.jpg. Don't edit by hand.

export const CREATOR_PHOTO_IDS: readonly string[] = ${JSON.stringify(photos, null, 2)};
`,
);
console.log(`\n${photos.length} creator photos on disk. Spent about $${spent.toFixed(2)}.`);
