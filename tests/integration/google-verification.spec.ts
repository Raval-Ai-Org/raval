import { test, expect } from "@playwright/test";
import axe from "axe-core";
test.setTimeout(120_000);

for (const [path, title] of [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
  ["/safety", "AI Safety and Acceptable Use"],
]) {
  test(`${path} serves readable public HTML and metadata without JavaScript`, async ({
    browser,
    request,
  }) => {
    const response = await request.get(path, { headers: { "User-Agent": "Googlebot" } });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()["x-robots-tag"] ?? "").not.toMatch(/noindex|none/i);
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(new URL(path, response.url()).href, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.locator("article")).toBeVisible();
    expect((await page.locator("article").innerText()).length).toBeGreaterThan(1000);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Mellox|information|terms/i,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${path}$`),
    );
    expect(await page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(
      true,
    );
    await context.close();
  });
  test(`${path} legal text and links pass accessibility checks`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: axe.source });
    const results = await page.evaluate(async () => {
      const audit = (window as unknown as { axe: typeof axe }).axe;
      return audit.run("article", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    });
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    for (const link of ["/privacy", "/terms", "/safety"])
      await expect(page.locator(`footer a[href="${link}"]`)).toBeVisible();
  });
}

test("homepage explains Google access, AI processing, purpose and policies", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const section = page.locator('section[aria-labelledby="google-marketing-data"]');
  await expect(section).toContainText("Google Analytics and Google Search Console");
  await expect(section).toContainText("read-only");
  await expect(section).toContainText("processed by AI");
  await expect(section).toContainText("businesses and agencies");
  for (const link of ["/privacy#google-data", "/terms", "/safety"])
    await expect(section.locator(`a[href="${link}"]`)).toHaveCount(1);
});

test("privacy accurately discloses Google fields, AI providers, revocation and deletion limits", async ({
  page,
  request,
}) => {
  await page.goto("/privacy", { waitUntil: "domcontentloaded" });
  const text = await page.locator("article").innerText();
  for (const term of [
    "analytics.readonly",
    "webmasters.readonly",
    "purchase revenue",
    "OpenRouter",
    "AES-256-GCM",
    "experiment",
    "Disconnect",
    "privacy@mellox.ai",
    "Limited Use",
  ])
    expect(text).toContain(term);
  await expect(
    page.locator(
      'article a[href="https://developers.google.com/terms/api-services-user-data-policy"]',
    ),
  ).toHaveCount(1);
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).not.toMatch(/Disallow:\s*\/(privacy|terms|safety)(?:\s|\/)/);
});
