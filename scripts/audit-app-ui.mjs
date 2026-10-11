import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// Local-only visual audit: never publishes content or calls paid providers.
const require = createRequire(import.meta.url);
const out = path.resolve(process.env.UI_AUDIT_OUTPUT || ".tmp-run/ui-audit/screens");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const sizes = [
  [320, 568],
  [390, 844],
  [667, 375],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
];
const routes = [
  ["/chat-lab", "chat"],
  ["/analytics-lab", "analytics"],
  ["/brain-lab?scene=home", "brain"],
  ["/brain-lab?scene=strategy-draft", "strategy"],
  ["/brain-lab?scene=look", "brand-style"],
  ["/autopilot-lab?scene=setup", "autopilot-setup"],
  ["/autopilot-lab?scene=approvals", "autopilot-review"],
  ["/audience-lab?state=ready", "audience"],
  ["/calendar-lab", "calendar"],
  ["/connections-lab", "connections"],
  ["/memory-lab?scene=ready", "memory"],
  ["/links-lab", "links"],
  ["/upgrade-lab?scene=free", "upgrade"],
  ["/projects-lab", "projects"],
  ["/login", "login"],
  ["/signup", "signup"],
];
const selectedNames = process.env.UI_AUDIT_ROUTES?.split(",");
const themes = (process.env.UI_AUDIT_THEMES || "light,dark").split(",");
const selectedRoutes = selectedNames
  ? routes.filter(([, name]) => selectedNames.includes(name))
  : routes;
// A targeted rerun replaces those captures while preserving the full audit.
const results = selectedNames
  ? JSON.parse(await readFile(path.join(out, "results.json"), "utf8")).filter(
      (r) => !selectedNames.includes(r.name) || !themes.includes(r.theme),
    )
  : [];
const axe = require.resolve("axe-core/axe.min.js");
for (const theme of themes) {
  const context = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce" });
  await context.addInitScript((t) => localStorage.setItem("mellox:theme", t), theme);
  await context.route(/^https?:\/\/(?!localhost:8080)/, (r) => r.abort());
  // The lab components provide realistic UI fixtures. Reject external traffic
  // and unrelated API calls so a QA run cannot consume credits or mutate data.
  await context.route("**/api/**", (r) =>
    r.fulfill({ status: 503, json: { error: "Local visual audit" } }),
  );
  for (const [url, name] of selectedRoutes) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`http://localhost:8080${url}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await page.waitForFunction(() => document.body.innerText.length > 40, { timeout: 30000 });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      if (["brain", "strategy", "brand-style"].includes(name))
        await page
          .locator('[data-testid="brain-lab-frame"][data-ready="true"]')
          .waitFor({ timeout: 60000 });
      if (name === "memory")
        await page
          .locator('[data-testid="memory-lab-frame"][data-ready="true"]')
          .waitFor({ timeout: 60000 });
      if (name === "upgrade")
        await page
          .locator('[data-testid="upgrade-lab-frame"][data-ready="true"]')
          .waitFor({ timeout: 60000 });
      if (name === "calendar")
        await page.getByRole("button", { name: "Previous month" }).waitFor({ timeout: 60000 });
      await page.waitForTimeout(8000);
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(200);
        const metrics = await page.evaluate(() => {
          const vw = innerWidth;
          const visible = (el) =>
            el.getBoundingClientRect().width > 0 &&
            el.getBoundingClientRect().height > 0 &&
            getComputedStyle(el).visibility !== "hidden";
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            dark: document.documentElement.classList.contains("dark"),
            text: document.body.innerText.length,
            clipped: [...document.querySelectorAll('button,input,textarea,[role="tab"]')]
              .filter(visible)
              .filter((el) => {
                const r = el.getBoundingClientRect();
                // A horizontal scroller is intentional; report controls in the page.
                let parent = el.parentElement;
                while (parent && parent !== document.body) {
                  if (["auto", "scroll", "hidden"].includes(getComputedStyle(parent).overflowX))
                    return false;
                  parent = parent.parentElement;
                }
                return r.left < -1 || r.right > vw + 1;
              })
              .map((el) => ({
                text: (el.getAttribute("aria-label") || el.textContent || el.tagName).slice(0, 100),
                class: el.className,
              })),
          };
        });
        const file = `${name}-${theme}-${width}x${height}.png`;
        await page.screenshot({
          path: path.join(out, file),
          fullPage: true,
          animations: "disabled",
        });
        let accessibility = [];
        if (width === 390 || width === 1440) {
          await page.addScriptTag({ path: axe });
          accessibility = await page.evaluate(async () =>
            (
              await window.axe.run(document, {
                runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
              })
            ).violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              nodes: v.nodes.map((n) => ({
                target: n.target,
                summary: n.failureSummary,
                html: n.html,
              })),
            })),
          );
        }
        results.push({
          name,
          url,
          theme,
          width,
          height,
          file,
          ...metrics,
          errors: [...errors],
          accessibility,
        });
        console.log(
          `${name} ${theme} ${width}: overflow=${metrics.overflow}, a11y=${accessibility.length}, errors=${errors.length}`,
        );
      }
    } catch (e) {
      results.push({ name, theme, error: String(e) });
      console.log(`${name}: ${e.message}`);
    }
    await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
    await page.close();
  }
  await context.close();
}
await browser.close();
console.log(`Audit saved to ${out}`);
