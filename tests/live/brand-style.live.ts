// Live check of the brand style bible (ADR-0048) against a real website.
//
//   STYLE_LIVE_URL=https://example.com \
//     npx vitest run --config vitest.live.config.ts tests/live/brand-style.live.ts
//
// Without STYLE_LIVE_AI it only opens the page in the guarded browser (no
// spend): the screenshot, section crops, artwork crops and design tokens are
// written to .live-out/brand-style/ for a look. STYLE_LIVE_AI=yes also sends
// them to the real analysis model (route brand-visuals.analyze, a few cents)
// and prints the grounded style bible. Nothing is written to the database.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: only the capture runs.
}

const URL_UNDER_TEST = process.env.STYLE_LIVE_URL?.trim();
const REAL_AI = process.env.STYLE_LIVE_AI === "yes";
const describeLive = URL_UNDER_TEST ? describe : describe.skip;
const OUT = path.resolve(".live-out/brand-style");

describeLive("brand style bible, live", () => {
  it(
    "captures the page, its artwork and tokens, and (opt-in) learns a grounded bible",
    async () => {
      const { captureVisualPage } = await import("@/server/brand-visuals/capture.server");
      const page = await captureVisualPage(URL_UNDER_TEST!);
      mkdirSync(OUT, { recursive: true });
      for (const [i, image] of page.images.entries())
        writeFileSync(
          path.join(OUT, `${i}-${String(image.region.type)}.png`),
          image.bytes,
        );
      writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(page.tokens, null, 2));
      const kinds = page.images.map((i) => i.region.type);
      console.log("[brand-style] captured", kinds.join(", "), "→", OUT);
      expect(kinds).toContain("full");
      expect(kinds).toContain("section");

      if (!REAL_AI) return;
      const [{ chatCompletion }, { ANALYSIS_PROMPT }, { ProfileSchema }, { groundProfile }] =
        await Promise.all([
          import("@/lib/ai-gateway.server"),
          import("@/server/brand-visuals/worker.server"),
          import("@/lib/brand-visuals/contracts"),
          import("@/lib/brand-visuals/bible"),
        ]);
      const { safeParseJson } = await import("@/lib/ai/json");
      const pictures = page.images
        .filter((i) => i.region.type !== "full" || !i.region.mobile)
        .slice(0, 10)
        .map((image) => ({ id: randomUUID(), image }));
      const content: (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[] = [
        { type: "text", text: ANALYSIS_PROMPT },
        { type: "text", text: `Measured website evidence: ${JSON.stringify(page.tokens).slice(0, 9000)}` },
      ];
      for (const { id, image } of pictures) {
        const full = image.region.type === "full";
        const jpeg = await sharp(image.bytes)
          .resize({ width: full ? 900 : 1100, height: full ? 2400 : 1600, fit: "inside" })
          .jpeg({ quality: 80 })
          .toBuffer();
        content.push({
          type: "text",
          text: JSON.stringify({
            sourceId: id,
            evidence:
              image.region.type === "full"
                ? "overview of the whole website page (shrunk)"
                : image.region.type === "art"
                  ? "artwork shown on the brand's website"
                  : "section of the brand's website",
          }),
        });
        content.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
        });
      }
      const response = await chatCompletion({
        route: "brand-visuals.analyze",
        noCache: true,
        max_tokens: 7000,
        timeoutMs: 90_000,
        messages: [{ role: "user", content }],
      });
      const raw = safeParseJson<unknown>(String(response?.choices?.[0]?.message?.content ?? ""), null);
      const overview = new Set(pictures.filter((p) => p.image.region.type === "full").map((p) => p.id));
      const ids = new Set(pictures.map((p) => p.id).filter((id) => !overview.has(id)));
      const profile = groundProfile(ProfileSchema.parse(raw), { analysed: ids, ownIds: ids });
      writeFileSync(path.join(OUT, "profile.json"), JSON.stringify(profile, null, 2));
      console.log("[brand-style] bible", JSON.stringify(profile.directions[0]?.bible, null, 2));
      expect(profile.directions.length).toBeGreaterThan(0);
      expect(profile.directions[0].bible?.world.medium).toBeTruthy();
    },
    240_000,
  );
});
