// Offline layout verification; never clicks or sends authentication links.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".tmp-run", "auth-email-previews");
const savePreviews = !process.argv.includes("--check-only");
const templates = [
  "confirmation",
  "recovery",
  "invite",
  "magic-link",
  "email-change",
  "reauthentication",
];
const logo = await readFile(join(root, "public/assets/mellox-email-mark.png"));
// Optional real-font verification. Cache the three Latin font files in memory
// so screenshots are stable and no authentication URL is ever requested.
const fontResources = new Map();
if (process.argv.includes("--fonts")) {
  const fontURL =
    "https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@8..144,100..1000&family=Michroma:wght@400&family=Micro+5:wght@400&display=swap";
  const response = await fetch(fontURL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, "Google Fonts stylesheet unavailable");
  const css = await response.text();
  const latinFaces = [...css.matchAll(/\/\* latin \*\/\s*(@font-face\s*\{[^}]+\})/g)]
    .map((match) => match[1])
    .join("\n");
  assert(
    latinFaces.includes("Google Sans Flex") &&
      latinFaces.includes("Michroma") &&
      latinFaces.includes("Micro 5"),
    "Landing font faces unavailable",
  );
  fontResources.set(fontURL, { contentType: "text/css", body: latinFaces });
  for (const [, url] of latinFaces.matchAll(/url\((https:[^)]+)\)/g)) {
    const font = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert(font.ok, `Font unavailable: ${url}`);
    fontResources.set(url, {
      contentType: "font/woff2",
      body: Buffer.from(await font.arrayBuffer()),
    });
  }
}
if (savePreviews) await mkdir(output, { recursive: true });
const browser = await chromium.launch();
let checks = 0;
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  // Only the local logo and explicitly cached fonts may load.
  await page.route("**/*", (route) =>
    route.request().url() === "https://mellox.ai/assets/mellox-email-mark.png"
      ? route.fulfill({ contentType: "image/png", body: logo })
      : fontResources.has(route.request().url())
        ? route.fulfill({
            ...fontResources.get(route.request().url()),
            headers: { "access-control-allow-origin": "*" },
          })
        : route.abort(),
  );
  for (const name of templates) {
    const source = await readFile(join(root, "supabase/email-templates", `${name}.html`), "utf8");
    assert(
      !/<script\b|<form\b|on(?:click|load|error)=/i.test(source),
      `${name}: executable content`,
    );
    assert(Buffer.byteLength(source) < 102_400, `${name}: Gmail clipping threshold`);
    const html = source
      .replaceAll("{{ .TokenHash }}", "a".repeat(128))
      .replaceAll("{{ .Token }}", "123456");
    for (const width of [320, 375, 600, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(html, { waitUntil: "networkidle" });
      if (fontResources.size) {
        await page.evaluate(() => document.fonts.ready);
        const loaded = await page.evaluate(() =>
          [...document.fonts]
            .filter((face) => face.status === "loaded")
            .map((face) => face.family.replaceAll('"', "")),
        );
        for (const family of ["Google Sans Flex", "Michroma", "Micro 5"])
          assert(loaded.includes(family), `${name}: ${family} failed to load`);
      }
      const measurements = await page.evaluate(() => ({
        viewport: innerWidth,
        content: document.documentElement.scrollWidth,
        imageReady: document.querySelector("img").naturalWidth > 0,
        animations: [...document.querySelectorAll(".motif,.spark")].map(
          (el) => getComputedStyle(el).animationName,
        ),
        ctaHeight: document.querySelector(".cta")?.getBoundingClientRect().height,
      }));
      const lowContrast = await page.evaluate(() => {
        const rgb = (color) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const luminance = (color) =>
          rgb(color)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        return [...document.querySelectorAll("h1,h2,h3,p,a,.wordmark span")].flatMap((el) => {
          if (!el.textContent.trim()) return [];
          let ancestor = el;
          while (ancestor && getComputedStyle(ancestor).backgroundColor === "rgba(0, 0, 0, 0)")
            ancestor = ancestor.parentElement;
          const fg = luminance(getComputedStyle(el).color);
          const bg = luminance(
            ancestor ? getComputedStyle(ancestor).backgroundColor : "rgb(255, 255, 255)",
          );
          const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          return ratio < 4.5 ? [{ text: el.textContent.slice(0, 50), ratio }] : [];
        });
      });
      assert.deepEqual(lowContrast, [], `${name}: insufficient text contrast at ${width}px`);
      assert(measurements.content <= measurements.viewport, `${name}: overflow at ${width}px`);
      assert(measurements.imageReady, `${name}: logo failed`);
      assert(
        measurements.animations.every((value) => value === "none"),
        `${name}: reduced motion failed`,
      );
      assert(
        measurements.ctaHeight === undefined || measurements.ctaHeight >= 44,
        `${name}: small touch target`,
      );
      if (savePreviews && (width === 375 || width === 900))
        await page.screenshot({ path: join(output, `${name}-${width}.png`), fullPage: true });
      checks++;
    }
    // Simulate a client stripping head styles and blocking remote images.
    const fallback = html
      .replace(/<style>[\s\S]*?<\/style>/g, "")
      .replace(/<link\b[^>]*>/g, "")
      .replace(/<img\b[^>]*>/g, "");
    await page.setViewportSize({ width: 320, height: 900 });
    await page.setContent(fallback);
    assert(
      await page.getByRole("heading", { level: 1 }).isVisible(),
      `${name}: fallback heading missing`,
    );
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${name}: fallback overflow`,
    );
    if (name !== "reauthentication")
      assert(await page.locator(".cta").isVisible(), `${name}: fallback action missing`);
    else
      assert(
        await page.getByText("123456", { exact: true }).isVisible(),
        `${name}: fallback code missing`,
      );
    checks++;
    // Preview HTML has a non-secret example token and an embedded local logo.
    if (savePreviews)
      await writeFile(
        join(output, `${name}.html`),
        html.replace(
          "https://mellox.ai/assets/mellox-email-mark.png",
          `data:image/png;base64,${logo.toString("base64")}`,
        ),
      );
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setContent(
    await readFile(join(root, "supabase/email-templates/confirmation.html"), "utf8"),
  );
  assert.equal(
    await page.locator(".motif").evaluate((el) => getComputedStyle(el).animationName),
    "mellox-float",
  );
  if (savePreviews)
    await writeFile(
      join(output, "index.html"),
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mellox auth email previews</title><body style="margin:0;padding:32px;background:#F6F7F2;color:#243037;font-family:Arial,sans-serif"><h1>Mellox AI · Authentication emails</h1><p>Local previews with example tokens. Do not use preview links to authenticate.</p><nav style="line-height:2">${templates.map((name) => `<a style="color:#40531B;margin-right:20px" href="${name}.html" target="email">${name}</a>`).join("")}</nav><iframe title="Email preview" name="email" src="confirmation.html" style="margin-top:24px;width:100%;height:1500px;border:1px solid #DCE4D7;border-radius:20px"></iframe></body></html>`,
    );
  console.log(
    `Passed ${checks} layout/fallback checks plus animation verification.${savePreviews ? ` Previews: ${output}` : " No preview files written."}`,
  );
} finally {
  await browser.close();
}
