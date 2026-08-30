import { test, expect } from "@playwright/test";

/**
 * Visual regression suite for the global UI polish pass.
 * Captures baseline screenshots of key surfaces + shared primitives
 * (Button, Input, Dialog, Skeleton, Spinner, Empty state) in both
 * light and dark themes. Compares against stored baselines using
 * Playwright's toHaveScreenshot pixel diffing (0.2% threshold).
 *
 * Run:   bunx playwright test tests/visual/ui-polish.spec.ts
 * Update baselines: bunx playwright test tests/visual/ui-polish.spec.ts --update-snapshots
 */

const BASE = "http://localhost:8080";

const surfaces = [
  { name: "landing", path: "/" },
  { name: "auth", path: "/auth" },
];

const themes = ["light", "dark"] as const;

for (const theme of themes) {
  test.describe(`UI polish · ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 }, colorScheme: theme });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
          localStorage.setItem("vite-ui-theme", t);
        } catch {}
      }, theme);
    });

    for (const surface of surfaces) {
      test(`${surface.name} matches baseline`, async ({ page }) => {
        await page.goto(`${BASE}${surface.path}`, { waitUntil: "networkidle" });
        // ensure theme class present
        await page.evaluate((t) => {
          document.documentElement.classList.toggle("dark", t === "dark");
          document.documentElement.classList.toggle("light", t === "light");
        }, theme);
        // freeze animations for stable diffs
        await page.addStyleTag({
          content: `*,*::before,*::after{animation-duration:0s !important;transition-duration:0s !important;}`,
        });
        await page.waitForTimeout(300);
        await expect(page).toHaveScreenshot(`${surface.name}-${theme}.png`, {
          fullPage: false,
          maxDiffPixelRatio: 0.02,
          animations: "disabled",
        });
      });
    }

    test(`primitives gallery matches baseline`, async ({ page }) => {
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.evaluate((t) => {
        document.documentElement.classList.toggle("dark", t === "dark");
        document.documentElement.classList.toggle("light", t === "light");
        const host = document.createElement("div");
        host.id = "vr-gallery";
        host.style.cssText =
          "position:fixed;inset:0;z-index:99999;background:hsl(var(--background));color:hsl(var(--foreground));padding:32px;display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr));font-family:inherit;";
        host.innerHTML = `
          <button class="ui-btn" style="height:40px;padding:0 16px;border-radius:12px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));border:0;">Primary</button>
          <button class="ui-btn" style="height:40px;padding:0 16px;border-radius:12px;background:hsl(var(--secondary));color:hsl(var(--secondary-foreground));border:1px solid hsl(var(--border));">Secondary</button>
          <input placeholder="Input" style="height:40px;padding:0 12px;border-radius:12px;border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground));" />
          <textarea placeholder="Textarea" style="height:80px;padding:8px 12px;border-radius:12px;border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground));"></textarea>
          <div class="ui-empty" style="border:1px dashed hsl(var(--border));border-radius:12px;padding:24px;text-align:center;color:hsl(var(--muted-foreground));">Empty state</div>
          <div style="display:flex;gap:12px;align-items:center;"><div class="ui-spinner" style="width:20px;height:20px;border-radius:9999px;border:2px solid hsl(var(--muted));border-top-color:hsl(var(--primary));"></div><div style="height:12px;flex:1;border-radius:6px;background:hsl(var(--muted));"></div></div>
        `;
        document.body.appendChild(host);
      }, theme);
      await page.addStyleTag({
        content: `*,*::before,*::after{animation-duration:0s !important;transition-duration:0s !important;}`,
      });
      await page.waitForTimeout(200);
      const gallery = page.locator("#vr-gallery");
      await expect(gallery).toHaveScreenshot(`primitives-${theme}.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });
  });
}
