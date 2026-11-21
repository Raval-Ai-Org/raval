// Paid A/B of Studio's post pipeline against a "director" pipeline (one
// strong writer, one short prompt, no references). Owner-approved run only:
//   STUDIO_AB_LIVE=yes npx vitest run --config vitest.live.config.ts tests/live/studio-ab.live.ts
// A = today (Haiku plan + postImagePrompt, Flare medium). B = director prompt,
// Flare medium. C = director prompt, Flare high. Pictures in .live-out/ab/.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env */
}

const RUN = process.env.STUDIO_AB_LIVE === "yes";
const OUT = path.resolve(".live-out/ab");
const SPEND_CAP_USD = 1.2;

const BRAND = {
  name: "Northwind Coffee",
  text: "Northwind Coffee is a specialty coffee roaster and cafe in Lahore that sells roasted coffee beans. Voice: warm, plain, craft-proud. Colours #1F2A1C, #E9DCC3, #C2410C. Fonts: Space Grotesk, Inter. Products: Midnight Espresso Blend, Ethiopian Yirgacheffe.",
  palette: ["#1F2A1C", "#E9DCC3", "#C2410C"],
  fonts: ["Space Grotesk", "Inter"],
};

const POSTS = [
  {
    id: "hiring",
    platform: "linkedin",
    brief: "We're hiring 2 senior baristas for our Gulberg branch in Lahore. Apply by Dec 5.",
  },
  {
    id: "offer",
    platform: "instagram",
    brief: "20% off all whole-bean bags this weekend, Nov 21 to 23, in store and online.",
  },
  {
    id: "event",
    platform: "instagram",
    brief: "Free latte art workshop this Saturday, Nov 22, 4pm at our Gulberg cafe. 12 seats.",
  },
] as const;
const CAROUSEL = {
  id: "carousel",
  platform: "instagram",
  brief: "How to brew great pour-over coffee at home in 4 steps",
  slides: 4,
};

let spent = 0;
const log: string[] = [];

const DIRECTOR_POST = `You are the creative director for a brand's social media feed. A person asked for one post. You write the single image prompt a top designer would hand to an image model (GPT Image) to make the finished post, typography included, plus the words on it.

Think first about what this brand's best real posts on this platform look like today: native to the feed, simple, confident, believable. Not an ad stunt, not a template, not a surreal concept. Pick the one format that fits the brief best (for example a real photo with a short headline, a bold type post on the brand colour, a clean announcement, a product photo on a simple set) and commit to it.

Rules: the post is about exactly what the brief says. Never name another brand, product or equipment maker. Use only facts the brief or brand gives; never invent a figure, date, price or claim. Headline at most 8 words, plain and strong. At most 2 short supporting lines, only when the brief has details worth showing (date, place, how to apply, the offer's condition).

imagePrompt: 120 to 260 words of plain, concrete prose describing the finished post: the format, the subject or scene (a real photograph must look like a real photograph), the composition and how much of the frame the subject fills, exactly where the headline and lines sit and how they are set (type character, weight, size relationship, colour by hex), the palette from the brand's hex colours, the light, the finish. Refer to the words as "the headline" and "the line"; their exact text is added after your prompt. No lists, no rule checklists.

Return JSON only: {"headline": string, "lines": string[], "imagePrompt": string, "caption": string}`;

const DIRECTOR_CAROUSEL = `You are the creative director for a brand's social media feed. A person asked for one carousel. You write the image prompts a top designer would hand to an image model (GPT Image) to make every finished slide, typography included, plus the words on each.

First decide one look for the whole series that suits the brief and the brand (for example clean editorial type on the brand colour with one real photo per slide, or a real step-by-step photo series with a consistent type band). Describe it in "look": background, grid, where the words sit, type character and colours by hex, photo treatment. Every slide follows it.

Rules: the carousel is about exactly what the brief says. Use only facts the brief or brand gives. Slide 1 is the hook (headline at most 7 words). Middle slides each make one point: a headline of at most 6 words and one line of at most 14 words. The last slide closes with the action. Never surreal concepts or metaphors: real, simple, well made.

Each slide's imagePrompt: 60 to 140 words of plain prose describing that slide's own picture and composition within the look. Refer to the words as "the headline" and "the line"; their exact text is added afterward.

Return JSON only: {"look": string, "slides": [{"headline": string, "line": string, "imagePrompt": string}], "caption": string}`;

function wordsBlock(headline: string, lines: string[]) {
  const all = [headline, ...lines].filter((s) => s.trim());
  if (!all.length) return "No words in the image.";
  return `The only text in the image, spelled exactly as written, each once, nothing else added:\n${all
    .map((s, i) => `${i === 0 ? "Headline" : "Line"}: "${s.trim()}"`)
    .join("\n")}`;
}

const describeLive = RUN ? describe : describe.skip;

describeLive("studio A/B, live (paid)", () => {
  it(
    "makes the same briefs both ways",
    async () => {
      const { runStructuredPrompt } = await import("@/lib/ai");
      const { llmJson } = await import("@/lib/ai-gateway.server");
      const { generateImage } = await import("@/lib/openrouter-image.server");
      const prompts = await import("@/lib/studio/prompts");
      const { readBrief } = await import("@/lib/studio/brief-read");
      const { offeredPostStyles, postStyleById, pickCarouselStyle } =
        await import("@/lib/studio/post-styles");
      const { postImagePrompt, carouselSlidePrompt } =
        await import("@/server/studio/visual-prompts.server");
      const { sellsPhysicalProduct } = await import("@/lib/studio/art-direction");
      mkdirSync(OUT, { recursive: true });

      const ctx = {
        ...prompts.emptyContext(BRAND.name),
        industry: "Cafe",
        brandText: BRAND.text,
        visualBrandText: BRAND.text,
      } as never;
      const physical = sellsPhysicalProduct(BRAND.text);
      const SIZE = "1024x1280" as const; // 4:5 posts render at 3:4

      async function render(
        file: string,
        prompt: string,
        quality: "medium" | "high",
        refs: string[] = [],
      ) {
        if (spent > SPEND_CAP_USD) throw new Error(`spend cap reached ($${spent.toFixed(3)})`);
        const started = Date.now();
        const img = await generateImage({
          prompt,
          size: SIZE,
          quality,
          budgeted: true,
          maxAttempts: 1,
          meterRoute: "studio.image.render",
          routing: { referenceAssets: refs, hasReference: refs.length > 0 },
        } as never);
        spent += img.costUsd ?? 0;
        const buf = Buffer.from(img.b64, "base64");
        writeFileSync(path.join(OUT, `${file}.png`), buf);
        writeFileSync(path.join(OUT, `${file}.prompt.txt`), prompt);
        log.push(
          `${file}\t${img.model}\t${quality}\t$${(img.costUsd ?? 0).toFixed(4)}\t${((Date.now() - started) / 1000).toFixed(0)}s\t${prompt.length} chars`,
        );
        return buf;
      }

      // ---------- single posts ----------
      // One at a time: OpenRouter holds money for every request in flight.
      for (const post of POSTS) {
        {
          const read = readBrief(post.brief);
          const intent = { brief: post.brief, goal: "awareness" } as never;
          const controls = { platforms: [post.platform] } as never;

          // A: today's writer and picture prompt.
          const built = prompts.buildVisualBriefPrompt({
            ctx,
            intent,
            controls,
            angle: prompts.BRIEF_ANGLE,
            briefRead: read,
            medium: "image",
          } as never);
          const plan = (await runStructuredPrompt({
            route: built.route,
            system: built.system,
            user: built.user,
            schema: built.schema,
            maxTokens: built.maxTokens,
          } as never)) as Record<string, unknown>;
          const offered = offeredPostStyles({
            read,
            platform: post.platform,
            physicalProduct: physical,
            recent: [],
            refine: false,
            seed: `${BRAND.name}:${post.brief}`,
          } as never);
          const pick = postStyleById(plan.postStyle);
          const style = pick && offered.some((s) => s.id === pick.id) ? pick : offered[0];
          const lines = ((plan.onImageLines as string[]) ?? []).slice(0, style?.maxLines ?? 3);
          const promptA = postImagePrompt({
            brandName: BRAND.name,
            concept: String(plan.concept ?? ""),
            postStyle: style,
            deliverable: read.deliverable,
            headline: String(plan.onImageText ?? ""),
            lines,
            ratio: "4:5",
            style: null,
            palette: BRAND.palette,
            fonts: BRAND.fonts,
            logoCorner: "bottom-right",
            physicalProduct: physical,
          } as never);

          // Director: one stronger writer, one short prompt.
          const dir = await llmJson<{
            headline: string;
            lines: string[];
            imagePrompt: string;
            caption: string;
          }>({
            route: "studio.plan.escalate",
            system: DIRECTOR_POST,
            user: `Brand: ${BRAND.text}\nPlatform: ${post.platform}\nFormat: portrait 4:5 feed post.\n\nThe brief: ${post.brief}`,
            maxTokens: 3000,
            fallback: { headline: "", lines: [], imagePrompt: "", caption: "" },
          });
          expect(dir.imagePrompt.length).toBeGreaterThan(200);
          const promptD = [
            dir.imagePrompt.trim(),
            wordsBlock(dir.headline, (dir.lines ?? []).slice(0, 2)),
            "Portrait 4:5 social media post; keep all words well inside the edges. No logo.",
          ].join("\n\n");
          writeFileSync(
            path.join(OUT, `${post.id}-copy.json`),
            JSON.stringify({ A: plan, style: style?.id, director: dir }, null, 2),
          );

          await render(`${post.id}-A-today`, promptA, "medium");
          await render(`${post.id}-C-director-high`, promptD, "high");
        }
      }

      // ---------- carousel (opt-in: STUDIO_AB_CAROUSEL=yes) ----------
      if (process.env.STUDIO_AB_CAROUSEL === "yes") {
        const read = readBrief(CAROUSEL.brief);
        const intent = { brief: CAROUSEL.brief, goal: "awareness" } as never;
        const controls = { platforms: [CAROUSEL.platform], slideCount: CAROUSEL.slides } as never;
        const carouselStyle = pickCarouselStyle({
          deliverable: read.deliverable,
          platform: CAROUSEL.platform,
          physicalProduct: physical,
          productAsked: read.productAsked,
          brief: CAROUSEL.brief,
          seed: "ab",
        } as never);
        const built = prompts.buildCarouselPrompt({
          ctx,
          intent,
          controls,
          angle: prompts.BRIEF_ANGLE,
          briefRead: read,
          carouselStyle,
        } as never);
        const plan = (await runStructuredPrompt({
          route: built.route,
          system: built.system,
          user: built.user,
          schema: built.schema,
          maxTokens: built.maxTokens,
        } as never)) as {
          slides: { heading: string; body: string; visual?: string; role?: string }[];
        };
        const slidesA = plan.slides.slice(0, CAROUSEL.slides);
        const spec = {
          theme: {
            bg: BRAND.palette[1],
            ink: BRAND.palette[0],
            accent: BRAND.palette[2],
            headingFont: BRAND.fonts[0],
            bodyFont: BRAND.fonts[1],
          },
        } as never;
        const slidePromptA = (i: number) =>
          carouselSlidePrompt({
            slide: slidesA[i] as never,
            index: i,
            slides: slidesA as never,
            spec,
            brandName: BRAND.name,
            brandContext: BRAND.text,
            ratio: "4:5",
            style: null,
            seed: "ab",
            anchoredToCover: i > 0,
            carouselStyle,
          } as never);

        const dir = await llmJson<{
          look: string;
          slides: { headline: string; line: string; imagePrompt: string }[];
        }>({
          route: "studio.plan.escalate",
          system: DIRECTOR_CAROUSEL,
          user: `Brand: ${BRAND.text}\nPlatform: ${CAROUSEL.platform}\nSlides: ${CAROUSEL.slides}, portrait 4:5.\n\nThe brief: ${CAROUSEL.brief}`,
          maxTokens: 4000,
          fallback: { look: "", slides: [] },
        });
        expect(dir.slides.length).toBeGreaterThanOrEqual(CAROUSEL.slides);
        const slidesD = dir.slides.slice(0, CAROUSEL.slides);
        const slidePromptD = (i: number) =>
          [
            `Slide ${i + 1} of ${slidesD.length} of an Instagram carousel. Series look: ${dir.look.trim()}`,
            i > 0
              ? "The attached image is slide 1 of this carousel: keep its look exactly (background, grid, type, colours, photo treatment) with this slide's own picture and words."
              : "",
            slidesD[i].imagePrompt.trim(),
            wordsBlock(slidesD[i].headline, slidesD[i].line ? [slidesD[i].line] : []),
            "Portrait 4:5; keep all words well inside the edges. No logo.",
          ]
            .filter(Boolean)
            .join("\n\n");
        writeFileSync(
          path.join(OUT, `carousel-copy.json`),
          JSON.stringify({ A: plan, style: carouselStyle.id, director: dir }, null, 2),
        );

        const asRef = async (buf: Buffer) =>
          `data:image/jpeg;base64,${(await sharp(buf).resize(768).jpeg({ quality: 85 }).toBuffer()).toString("base64")}`;
        await Promise.all([
          (async () => {
            const cover = await render("carousel-A-today-1", slidePromptA(0), "medium");
            const ref = await asRef(cover);
            await Promise.all(
              slidesA
                .slice(1)
                .map((_, k) =>
                  render(`carousel-A-today-${k + 2}`, slidePromptA(k + 1), "medium", [ref]),
                ),
            );
          })(),
          (async () => {
            const cover = await render("carousel-C-director-high-1", slidePromptD(0), "high");
            const ref = await asRef(cover);
            await Promise.all(
              slidesD
                .slice(1)
                .map((_, k) =>
                  render(`carousel-C-director-high-${k + 2}`, slidePromptD(k + 1), "high", [ref]),
                ),
            );
          })(),
        ]);
      }

      writeFileSync(path.join(OUT, "log.tsv"), log.join("\n"));
      console.log(`[studio-ab] spent $${spent.toFixed(3)}\n${log.join("\n")}`);
    },
    20 * 60_000,
  );
});
