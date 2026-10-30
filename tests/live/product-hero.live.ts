// Live check of product hero posters (ADR-0040): the real product photo is
// cut out by the image model (transparent PNG, checked like the server does),
// then `posts` posters in a row are planned, given their own idea and words
// by the concept writer, and rendered with the real prompt, each one seeing
// the looks before it, as the brand's feed would. The PNGs are written out
// for a person to look at. Opt-in (real spend, premium images):
//   PRODUCT_HERO_LIVE_AI=yes PRODUCT_HERO_LIVE_CASES=cases.json npx vitest run --config vitest.live.config.ts tests/live/product-hero.live.ts
// cases.json: [{ "photo": "path.jpg", "name": "...", "category": "...",
//   "description": "...", "benefits": ["..."], "brief": "...", "campaign": "...",
//   "caption": "...", "posts": 3, "brandName": "..." }]
// Output goes to PRODUCT_HERO_LIVE_OUT (default: a temp folder, printed).
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

type Case = {
  photo: string;
  name: string;
  category?: string;
  description?: string;
  benefits?: string[];
  brief?: string;
  campaign?: string;
  caption?: string;
  posts?: number;
  brandName?: string;
};

const casesFile = process.env.PRODUCT_HERO_LIVE_CASES;
const describeLive =
  process.env.PRODUCT_HERO_LIVE_AI === "yes" && process.env.OPENROUTER_API_KEY && casesFile
    ? describe
    : describe.skip;

describeLive("Product hero posters (live)", () => {
  it("cuts each product out and stages a run of different posters", async () => {
    const cases = JSON.parse(await readFile(casesFile!, "utf8")) as Case[];
    const out = process.env.PRODUCT_HERO_LIVE_OUT || (await mkdtemp(join(tmpdir(), "hero-")));
    await mkdir(out, { recursive: true });
    const { cutOut } = await import("@/server/studio/product-hero/cutout.server");
    const { writeHeroConcept } = await import("@/server/studio/product-hero/concept.server");
    const { generateImage } = await import("@/lib/openrouter-image.server");
    const { planProductHero } = await import("@/lib/studio/product-hero/plan");
    const { productPalette } = await import("@/lib/studio/product-hero/palette");
    const { productHeroPrompt } = await import("@/lib/studio/product-hero/prompt");
    const { stagingById } = await import("@/lib/studio/product-hero/stagings");
    type Look = ReturnType<typeof planProductHero>["look"];

    await Promise.all(
      cases.map(async (c, i) => {
        const tag = `${i + 1}-${basename(c.photo).replace(/\.\w+$/, "")}`;
        const photo = await readFile(c.photo);
        const cutout = await cutOut(photo, c.name);
        if (cutout) await writeFile(join(out, `${tag}-cutout.png`), cutout.png);
        const looks: Look[] = [];
        for (let n = 0; n < (c.posts ?? 1); n++) {
          const seed = `${tag}-${n}`;
          const recentLooks = [...looks].reverse();
          const plan = planProductHero({
            seed,
            brief: c.brief ?? "",
            product: c,
            recentLooks,
            context: c.campaign,
            cropped: cutout?.cropped,
          });
          const concept = await writeHeroConcept({
            brandName: c.brandName ?? "the brand",
            product: c,
            staging: plan.staging,
            look: plan.look,
            occasion: plan.occasion,
            topic: plan.topic,
            texture: plan.texture,
            ingredients: plan.ingredients,
            benefits: plan.copy.benefits ?? [],
            brief: c.brief ?? "",
            caption: c.caption,
            allowText: true,
            recent: recentLooks,
          });
          const look: Look = {
            ...plan.look,
            concept: concept.scene,
            headline: concept.headline ?? plan.look.headline,
            support: concept.support ?? plan.look.support,
          };
          looks.push(look);
          const staging = stagingById(look.staging)!;
          const prompt = productHeroPrompt({
            staging,
            palette: productPalette({ product: cutout?.colour ?? null, mood: look.palette }),
            productName: c.name,
            texture: plan.texture,
            ingredients: plan.ingredients,
            copy: {
              headline: look.headline,
              support: look.support,
              benefits: look.benefits?.length ? look.benefits : plan.copy.benefits,
            },
            look,
            occasion: plan.occasion,
            allowText: true,
            cutout: !!cutout,
            cropped: cutout?.cropped,
            original: !!cutout,
            series: false,
            brandName: c.brandName ?? "the brand",
            brandContext: [c.description, ...(c.benefits ?? [])].filter(Boolean).join("\n"),
            logoCorner: "bottom-right",
            emphasisSeed: seed,
          });
          const image = await generateImage({
            prompt,
            size: "1024x1280",
            routing: {
              referenceAssets: [
                cutout
                  ? `data:image/png;base64,${cutout.png.toString("base64")}`
                  : `data:image/jpeg;base64,${photo.toString("base64")}`,
                ...(cutout ? [`data:image/jpeg;base64,${photo.toString("base64")}`] : []),
              ],
              editing: true,
              brandPrecision: "strict",
              requiredQuality: "high",
            },
          });
          const name = `${seed}-${look.staging}-${look.palette}`;
          await writeFile(join(out, `${name}.png`), Buffer.from(image.b64, "base64"));
          await writeFile(join(out, `${name}-prompt.txt`), prompt);
          console.log(
            `[product-hero] ${seed}: ${look.staging} / ${look.palette} / ${look.light} / ${look.set}${look.occasion ? ` / ${look.occasion}` : ""} — "${look.headline ?? ""}" — idea: ${concept.scene ?? "(none)"} — $${image.costUsd}`,
          );
          expect(image.b64.length).toBeGreaterThan(1000);
        }
      }),
    );
    console.log(`[product-hero] posters in ${out}`);
  }, 1_800_000);
});
