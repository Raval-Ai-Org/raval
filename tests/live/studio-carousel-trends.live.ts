// Live check of the two things a mock can't show: that the shared social
// trends snapshot really collects and grounds itself, and that a carousel
// written by the real model holds together and draws into real images.
//
//   npx vitest run --config vitest.live.config.ts tests/live/studio-carousel-trends.live.ts
//
// Reading the stored snapshot is free. Collecting a new one (a few web searches
// and one small model call) only runs with TRENDS_LIVE_REFRESH=yes. The
// carousel test costs one text generation and writes nothing to the database;
// set CAROUSEL_LIVE_OUT=<dir> to keep the drawn slides.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const live = process.env.OPENROUTER_API_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeLive = live ? describe : describe.skip;

describeLive("social trends (live)", () => {
  it.runIf(process.env.TRENDS_LIVE_REFRESH === "yes")(
    "collects a grounded snapshot",
    async () => {
      const { refreshSocialTrendsIfDue } = await import("@/server/studio/social-trends.server");
      const state = await refreshSocialTrendsIfDue({ force: true });
      console.info(`[live] trends refresh: ${state}`);
      expect(["refreshed", "busy"]).toContain(state);
    },
    180_000,
  );

  it("reads the stored snapshot, every trend with a real link", async () => {
    const { getSocialTrends, resetSocialTrendsCache } =
      await import("@/server/studio/social-trends.server");
    const { trendLines } = await import("@/lib/studio/trends");
    resetSocialTrendsCache();
    const trends = await getSocialTrends();
    if (!trends) {
      console.info("[live] no current snapshot stored yet (run with TRENDS_LIVE_REFRESH=yes)");
      return;
    }
    console.info(`[live] ${trends.items.length} trends, collected ${trends.collectedAt}`);
    for (const t of trends.items) {
      console.info(`  [${t.platform}/${t.kind}] ${t.title} — ${t.detail} (${t.url})`);
      expect(t.url).toMatch(/^https?:\/\//);
    }
    expect(trends.items.length).toBeGreaterThanOrEqual(4);
    expect(trendLines(trends, ["instagram", "tiktok", "linkedin"])).not.toBe("");
  });
});

describeLive("carousel (live)", () => {
  it("writes one connected carousel and draws it", async () => {
    const { runStructuredPrompt } = await import("@/lib/ai");
    const { ANGLES, buildCarouselPrompt, emptyContext } = await import("@/lib/studio/prompts");
    const { carouselStoryIssue, normalizeSlides, pickCarouselStructure } =
      await import("@/lib/studio/carousel/story");
    const { carouselTheme, pickCarouselDesign } = await import("@/lib/studio/carousel/design");
    const { HOOK_STYLES } = await import("@/lib/studio/memory");
    const { getSocialTrends } = await import("@/server/studio/social-trends.server");
    const { renderCarouselSlides } = await import("@/server/studio/carousel-render.server");

    const angle = ANGLES.find((a) => a.id === "how-to")!;
    const structure = pickCarouselStructure({ seed: "live-1", angleId: angle.id });
    const built = buildCarouselPrompt({
      ctx: {
        ...emptyContext("Huila Roasters"),
        brandText:
          "Brand: Huila Roasters\nOne-liner: Small-batch specialty coffee sourced directly from a farmer co-op in Huila, Colombia.\nVoice: warm, curious, down-to-earth\nAudience: home coffee lovers aged 25-45\nProducts: single-origin beans, cold brew concentrate, pour-over kits",
        industry: "Specialty coffee",
        audience: "Home coffee lovers",
        website: "https://example.com",
        socialTrends: await getSocialTrends(),
        recent: [
          {
            title: "Meet the farmers behind our Huila beans",
            type: "social",
            channel: "instagram",
            angle: "story",
            createdAt: "2026-09-01",
            status: "published",
            hook: "Every bag starts with a handshake in Huila",
          },
        ],
      },
      intent: { brief: "Why home cold brew goes flat after a few days, and how to keep it bright" },
      controls: { platforms: ["instagram"], slideCount: 7 },
      angle,
      hook: HOOK_STYLES[0],
      carouselStructure: structure,
    });
    const parsed = await runStructuredPrompt({
      route: built.route,
      system: built.system,
      user: built.user,
      schema: built.schema,
      maxTokens: built.maxTokens,
      temperature: built.temperature,
      regenerate: true,
    });
    const slides = normalizeSlides(parsed.slides, 7);
    console.info(`[live] "${parsed.title}" · structure: ${structure.id}`);
    for (const [i, s] of slides.entries()) {
      console.info(
        `  ${i + 1}. [${s.role}] ${s.kicker ? `(${s.kicker}) ` : ""}${s.heading}${s.emphasis ? ` «${s.emphasis}»` : ""}\n     ${s.body.replace(/\n/g, " / ")}`,
      );
    }
    console.info(`  caption: ${parsed.caption.slice(0, 200)}`);
    expect(slides).toHaveLength(7);
    expect(carouselStoryIssue(slides)).toBeNull();
    expect(slides.filter((s) => s.kicker).length).toBeGreaterThanOrEqual(3);

    const palette = { primary: "#5b3a29", secondary: "#e9c46a", accent: "#2a9d8f" };
    const design = pickCarouselDesign({ profileKey: "live", seed: "live-1", palette });
    const images = await renderCarouselSlides({
      slides,
      design,
      theme: carouselTheme({ palette, fonts: { heading: "Fraunces" }, colorway: design.colorway }),
      ratio: "4:5",
      brand: "Huila Roasters",
      site: "example.com",
    });
    expect(images).toHaveLength(7);
    const out = process.env.CAROUSEL_LIVE_OUT;
    if (out) {
      mkdirSync(out, { recursive: true });
      const strip = await sharp({
        create: { width: 360 * images.length, height: 450, channels: 3, background: "#888888" },
      })
        .composite(
          await Promise.all(
            images.map(async (image, n) => ({
              input: await sharp(image).resize(360).toBuffer(),
              left: n * 360,
              top: 0,
            })),
          ),
        )
        .jpeg({ quality: 85 })
        .toBuffer();
      writeFileSync(join(out, "live-strip.jpg"), strip);
      images.forEach((image, n) => writeFileSync(join(out, `live-${n + 1}.jpg`), image));
    }
  }, 240_000);
});
