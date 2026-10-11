import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(".tmp-run/ui-audit/studio");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const axe = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const scenes = [
  "brief-social",
  "brief-story",
  "brief-error",
  "gen-image",
  "review-social",
  "review-image",
  "review-video-rendering",
  "review-story",
  "review-carousel",
  "review-article",
  "review-script",
  "review-ad",
  "review-approved",
  "review-scheduled",
  "review-partial",
  "library",
];
const sizes = [
  { width: 390, height: 844, device: "phone" },
  { width: 820, height: 1180, device: "tablet" },
  { width: 1440, height: 900, device: "window" },
];
const results = [];
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ colorScheme: theme });
  await context.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Local visual fixture" } }),
  );
  await context.route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `http://localhost:8080/studio-lab?scene=brief-social&device=phone&theme=${theme}`,
    { waitUntil: "domcontentloaded", timeout: 120000 },
  );
  await page.locator('[data-ready="true"]').waitFor({ timeout: 60000 });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.addScriptTag({ path: axe });
  for (const scene of scenes) {
    await page.locator("select").first().selectOption(scene);
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.getByRole("combobox", { name: "Window size" }).selectOption(size.device);
      await page.waitForTimeout(400);
      const file = `studio-${scene}-${theme}-${size.width}.png`;
      await page.screenshot({ path: path.join(out, file), fullPage: true, animations: "disabled" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const accessibility = await page.evaluate(async () =>
        (
          await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            html: n.html,
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      );
      results.push({
        name: `studio-${scene}`,
        theme,
        width: size.width,
        height: size.height,
        file,
        overflow,
        accessibility,
        errors: [...errors],
      });
      await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
      console.log(
        `${scene} ${theme} ${size.width}: overflow=${overflow} a11y=${accessibility.length}`,
      );
    }
  }
  await context.close();
}
await browser.close();
