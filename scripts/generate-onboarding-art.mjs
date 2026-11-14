#!/usr/bin/env node
// Staff tool: make the 3D Mox pictures the onboarding questions show
// (src/lib/onboarding/questions.ts, ADR-0049).
//
//   node scripts/generate-onboarding-art.mjs                 # every missing picture
//   node scripts/generate-onboarding-art.mjs goal-sales      # these, even if they exist
//   node scripts/generate-onboarding-art.mjs --list          # ids and prompts, no spend
//
// One paid image each on GPT Image 2.5 Sunburst (IMAGE_MODEL_PREMIUM, data
// collection denied), with Mellox's own Mox renders (scripts/mox-reference/)
// as references so every picture is the same character. Saved as
// public/brand/mox/onboarding/<id>.webp; src/lib/onboarding/art.ts is then
// rewritten to list the pictures on disk. Stops once the run passes $10.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env.local") });
dotenv.config({ path: join(root, ".env") });

const MAX_SPEND = 10;
const outDir = join(root, "public", "brand", "mox", "onboarding");

// Who Mox is. Every prompt starts with this so the character never drifts.
const MOX = [
  "The attached images show Mox, the mascot of the Mellox app. Draw exactly this character, unchanged:",
  "a big rounded matte white head, short lime-green swept hair with one tall flick at the front,",
  "round glossy black eyes with a small white highlight, thick dark-grey eyebrows, a small friendly smile,",
  "white headphones with dark-grey ear cups and a thin glowing lime ring,",
  "a lime-green one-piece suit with a dark-grey wedge on the left side, dark-grey collar, cuffs and soles,",
  "white mitten hands. Chibi proportions: the head is about as big as the body.",
  "Render: premium 3D character art, soft vinyl toy material, smooth matte surfaces, soft studio light,",
  "gentle ambient occlusion and a soft contact shadow, crisp clean edges.",
  "Never any text, letters, numbers, logos or watermark anywhere in the picture.",
].join(" ");

const CARD_BG =
  "Background: a soft, plain, very light backdrop (warm white fading to a faint mint glow), no objects in the background. Mox is centred, whole, filling about two thirds of the frame.";
const POSE_BG =
  "Background: fully transparent. Only Mox and what it holds, whole, centred, nothing cut off at the edges.";

/** id → [aspect ratio, background, what Mox is doing] */
const ART = {
  "world-day": [
    "16:9",
    "opaque",
    "A wide, calm 3D landscape that is Mox's world: soft rounded rolling hills in lime green and fresh mint, a few small round stylised trees, a pale winding path, a calm lake reflecting the sky, a soft pastel sky fading from warm white at the top to light mint and a hint of sky blue, a few soft rounded clouds. Mox stands small on the path in the lower left third, three-quarter view, looking toward the open centre. The centre and upper middle of the picture stay calm and empty (a headline and a search bar sit there). Dreamy, clean, premium, toy-like.",
  ],
  "world-finish": [
    "16:9",
    "opaque",
    "The same wide 3D world of soft rounded lime and mint hills and a calm lake, now at a warm golden hour with soft light rays, tiny lime sparkles floating in the air. Mox stands on a rounded hilltop in the lower right third, both arms raised in celebration. The centre and upper middle of the picture stay calm and open (a title sits there). Dreamy, clean, premium, toy-like.",
  ],
  "role-owner": [
    "1:1",
    "opaque",
    `Mox stands behind a small rounded shop counter with a tiny striped lime-and-white awning above, holding a paper shopping bag, welcoming. ${CARD_BG}`,
  ],
  "role-team": [
    "1:1",
    "opaque",
    `Mox sits at a small rounded desk with an open laptop whose screen shows simple lime bar charts (no text), a white coffee mug beside it, focused and happy. ${CARD_BG}`,
  ],
  "role-agency": [
    "1:1",
    "opaque",
    `Mox juggles three small floating rounded cards in different soft colours (lime, mint, warm white), like little brand cards with simple shapes and no text, playful. ${CARD_BG}`,
  ],
  "role-creator": [
    "1:1",
    "opaque",
    `Mox holds a phone up and films itself, with a round ring light on a stand behind it, a confident wink. ${CARD_BG}`,
  ],
  "team-mini": [
    "3:4",
    "transparent",
    `Mox stands facing the viewer, relaxed, arms at its sides, a small happy smile. ${POSE_BG}`,
  ],
  "goal-followers": [
    "1:1",
    "opaque",
    `Mox stands happy with small round floating bubbles around it, each holding a simple heart or a tiny person silhouette, in lime and white. ${CARD_BG}`,
  ],
  "goal-reach": [
    "1:1",
    "opaque",
    `Mox shouts into a glossy lime megaphone, with soft round sound-wave rings spreading out. ${CARD_BG}`,
  ],
  "goal-leads": [
    "1:1",
    "opaque",
    `Mox happily holds out a white envelope sealed with a lime heart, beside a small rounded white mailbox with its flag up. ${CARD_BG}`,
  ],
  "goal-sales": [
    "1:1",
    "opaque",
    `Mox walks carrying two shopping bags, one lime and one white, delighted. ${CARD_BG}`,
  ],
  "goal-engagement": [
    "1:1",
    "opaque",
    `Mox talks cheerfully with three empty rounded speech bubbles (no text) floating around it in lime, white and mint. ${CARD_BG}`,
  ],
  "goal-launch": [
    "1:1",
    "opaque",
    `Mox rides a small rounded white-and-lime rocket that is lifting off with a soft puffy cloud trail, excited. ${CARD_BG}`,
  ],
  "pose-magnifier": [
    "3:4",
    "transparent",
    `Mox holds a large magnifying glass up in front of one eye, curious, studying something. ${POSE_BG}`,
  ],
  "pose-calendar": [
    "3:4",
    "transparent",
    `Mox stands beside a big rounded wall-calendar board with a clean grid where a few squares are filled lime (no numbers, no text), pointing at it proudly. ${POSE_BG}`,
  ],
  "pose-relax": [
    "3:4",
    "transparent",
    `Mox leans back in a soft lime beanbag chair with its hands behind its head, eyes happily closed, completely relaxed. ${POSE_BG}`,
  ],
  "pose-jump": [
    "3:4",
    "transparent",
    `Mox jumps high in the air with both arms raised, overjoyed, legs tucked. ${POSE_BG}`,
  ],
  "pose-thumbs": [
    "3:4",
    "transparent",
    `Mox gives a big thumbs up with one hand and winks. ${POSE_BG}`,
  ],
  "pose-thinking": [
    "3:4",
    "transparent",
    `Mox stands with one hand on its chin, looking up thoughtfully. ${POSE_BG}`,
  ],
  "tone-corporate": [
    "1:1",
    "opaque",
    `Mox wears a small dark-grey blazer and a lime tie over its suit and holds a neat dark briefcase, standing upright and confident. ${CARD_BG}`,
  ],
  "tone-casual": [
    "1:1",
    "opaque",
    `Mox holds a white coffee cup in one hand and waves with the other, relaxed and friendly. ${CARD_BG}`,
  ],
  "tone-personal": [
    "1:1",
    "opaque",
    `Mox sits cross-legged writing in an open notebook with a pencil, warm and thoughtful. ${CARD_BG}`,
  ],
  "tone-funny": [
    "1:1",
    "opaque",
    `Mox laughs out loud with its eyes squeezed shut, holding its belly, little lime sparkle bursts around it. ${CARD_BG}`,
  ],
};

const SIZE = { "1:1": [768, 768], "3:4": [600, 800], "16:9": [1920, 1080] };

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const [id, [ratio, bg, what]] of Object.entries(ART))
    console.log(`${id}  ${ratio} ${bg}\n  ${what}\n`);
  process.exit(0);
}

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(1);
}
const model = process.env.IMAGE_MODEL_PREMIUM?.trim() || "openai/gpt-image-2.5-sunburst";
mkdirSync(outDir, { recursive: true });

const refs = ["mox-front.webp", "mox-sheet.webp"].map((f) => {
  const b64 = readFileSync(join(root, "scripts", "mox-reference", f)).toString("base64");
  return { type: "image_url", image_url: { url: `data:image/webp;base64,${b64}` } };
});

const ids = args.length ? args : Object.keys(ART).filter((id) => !existsSync(join(outDir, `${id}.webp`)));

async function generate(id) {
  const [ratio, background, what] = ART[id];
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Mellox onboarding art",
    },
    body: JSON.stringify({
      model,
      prompt: `${MOX}\n\n${what}`,
      aspect_ratio: ratio,
      quality: "high",
      resolution: "1K",
      background,
      output_format: "png",
      n: 1,
      input_references: refs,
      provider: { data_collection: "deny" },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in the answer: ${text.slice(0, 300)}`);
  const [w, h] = SIZE[ratio];
  const img = sharp(Buffer.from(b64, "base64")).resize({
    width: w,
    height: h,
    fit: background === "transparent" ? "contain" : "cover",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  const webp = await img.webp({ quality: ratio === "16:9" ? 80 : 84, alphaQuality: 90 }).toBuffer();
  writeFileSync(join(outDir, `${id}.webp`), webp);
  return Number(json?.usage?.cost) || 0;
}

let spent = 0;
for (const id of ids) {
  if (!ART[id]) {
    console.warn(`skip ${id}: not a known picture`);
    continue;
  }
  if (spent >= MAX_SPEND) {
    console.warn(`stop: spent $${spent.toFixed(2)}, over the $${MAX_SPEND} cap`);
    break;
  }
  try {
    const cost = await generate(id);
    spent += cost;
    console.log(`ok   ${id}${cost ? `  $${cost.toFixed(4)}` : ""}`);
  } catch (error) {
    console.error(`fail ${id}: ${error.message}`);
  }
}

// The picture list the app reads: only files that really exist.
const known = new Set(Object.keys(ART));
const onDisk = readdirSync(outDir)
  .filter((f) => f.endsWith(".webp") && known.has(f.slice(0, -5)))
  .map((f) => f.slice(0, -5))
  .sort();
writeFileSync(
  join(root, "src/lib/onboarding/art.ts"),
  `// Written by scripts/generate-onboarding-art.mjs: the 3D Mox pictures at
// public/brand/mox/onboarding/<id>.webp. Don't edit by hand.

export const ONBOARDING_ART_IDS = ${JSON.stringify(onDisk, null, 2)} as const;

export type OnboardingArtId = (typeof ONBOARDING_ART_IDS)[number];

const ON_DISK: ReadonlySet<string> = new Set(ONBOARDING_ART_IDS);

/** The picture's URL, or null when it hasn't been made (callers fall back to a Mox render). */
export function onboardingArt(id: string | undefined | null): string | null {
  return id && ON_DISK.has(id) ? \`/brand/mox/onboarding/\${id}.webp\` : null;
}
`,
);
console.log(`\n${onDisk.length} onboarding pictures on disk. Spent about $${spent.toFixed(2)}.`);
