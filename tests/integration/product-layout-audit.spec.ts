import { expect, test, type Page } from "@playwright/test";
import { prepareAppUi } from "../fixtures/app-ui";

type Scene = { path: string; click?: string; root?: string };

const surfaces: Scene[] = [
  { path: "/projects-lab" },
  ...["website", "apps", "assistants", "assistants-viewer"].map((click) => ({
    path: "/connections-lab",
    click,
  })),
  ...["ready", "empty", "viewer", "off", "chat"].map((scene) => ({
    path: `/memory-lab?scene=${scene}`,
    root: '[data-testid="memory-lab-frame"]',
  })),
  ...["setup", "home", "approvals", "ideas", "activity", "settings", "paused"].map((scene) => ({
    path: `/autopilot-lab?scene=${scene}`,
    root: '[data-testid="autopilot-lab-frame"]',
  })),
  ...["ready", "empty", "building", "viewer", "compare"].map((state) => ({
    path: `/audience-lab?state=${state}`,
  })),
  ...[
    "brief-social",
    "brief-article",
    "brief-template",
    "brief-blueprint",
    "brief-error",
    "brief-story",
    "gen-image",
    "gen-article",
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
    "library",
  ].map((scene) => ({ path: `/studio-lab?scene=${scene}&device=phone` })),
  { path: "/links-lab" },
  { path: "/canva-lab" },
  { path: "/inspo-lab" },
  { path: "/analytics-lab" },
  { path: "/calendar-lab" },
  ...["plans", "credits", "member", "confirm", "loading"].map((scene) => ({
    path: `/upgrade-lab?scene=${scene}`,
    root: '[role="dialog"]',
  })),
];

const publicPages: Scene[] = [
  "/",
  "/pricing",
  "/compare",
  "/demo",
  "/faq",
  "/docs",
  "/integrations",
  "/about",
  "/contact",
  "/contact/partner",
  "/contact/press",
  "/blog",
  "/security",
  "/privacy",
  "/terms",
  "/safety",
  "/cookies",
  "/changelog",
  "/login",
  "/signup",
  "/reset-password",
].map((path) => ({ path }));

/** Look inside clipping ancestors; a hidden body scrollbar can mask broken UI. */
async function layoutProblems(page: Page, rootSelector?: string) {
  return page.evaluate((selector) => {
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return ["Surface did not render"];
    const problems: string[] = [];
    const seen = new Set<string>();
    const add = (reason: string, el: HTMLElement) => {
      const label = (el.getAttribute("aria-label") || el.textContent || el.tagName)
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 100);
      const message = `${reason}: ${label}`;
      if (!seen.has(message)) {
        seen.add(message);
        problems.push(message);
      }
    };
    for (const el of root.querySelectorAll<HTMLElement>(
      'button, input:not([type="hidden"]), textarea, select, [role="tab"], [role="combobox"]',
    )) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        !rect.width ||
        !rect.height ||
        style.visibility === "hidden" ||
        el.closest('[aria-hidden="true"], nextjs-portal')
      )
        continue;
      // Visually hidden native select mirrors are not user controls.
      if (rect.width <= 2 && rect.height <= 2) continue;
      if (
        el.tagName === "BUTTON" &&
        style.overflowX !== "auto" &&
        el.scrollWidth > el.clientWidth + 2
      )
        add("Label overflows button", el);
      if (el.tagName === "BUTTON" && el.scrollHeight > el.clientHeight + 3)
        add("Label overflows button height", el);
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const s = getComputedStyle(parent);
        if (s.overflowX === "auto" || s.overflowX === "scroll") break;
        const bounds = parent.getBoundingClientRect();
        if (
          (s.overflowX === "hidden" || s.overflowX === "clip") &&
          (rect.left < bounds.left - 2 || rect.right > bounds.right + 2)
        ) {
          add("Control clipped horizontally", el);
          break;
        }
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    )) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
      // Inline panels are allowed to scroll with the document.
      if (
        !el.closest("[data-radix-popper-content-wrapper]") &&
        getComputedStyle(el).position !== "fixed"
      )
        continue;
      if (rect.left < -2 || rect.right > innerWidth + 2)
        add("Popup outside horizontal viewport", el);
      if (rect.top < -2 || rect.bottom > innerHeight + 2)
        add("Popup outside vertical viewport", el);
    }
    if (document.documentElement.scrollWidth > innerWidth + 2)
      problems.push("Page overflows horizontally");
    return problems;
  }, rootSelector);
}

const moduleScenes: Scene[] = [
  "ugc-product",
  "ugc-empty",
  "ugc-brief",
  "ugc-concepts",
  "ugc-script",
  "ugc-generate",
  "ugc-blocked",
  "ugc-failed",
  "geo-scan",
  "agent",
].map((scene) => ({
  path: `/layout-lab?scene=${scene}`,
  root: scene === "agent" ? '[role="dialog"]' : '[data-testid="module-states"]',
}));

for (const group of ["product", "public", "modules"] as const) {
  for (const width of [320, 667, 1440]) {
    test(`${group} layout audit at ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(600_000);
      await page.setViewportSize({ width, height: width === 667 ? 375 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.setDefaultNavigationTimeout(120_000);
      if (group !== "public") await prepareAppUi(page, "light");
      else {
        await page.context().route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
        await page.context().route("**/api/**", (route) => route.fulfill({ json: {} }));
      }
      const findings: Array<{ scene: string; problems: string[] }> = [];
      for (const scene of group === "product"
        ? surfaces
        : group === "modules"
          ? moduleScenes
          : publicPages) {
        const response = await page.goto(scene.path, { waitUntil: "domcontentloaded" });
        expect(response?.ok(), scene.path).toBe(true);
        await expect
          .poll(
            async () =>
              (
                await page
                  .locator(scene.root ?? "body")
                  .first()
                  .innerText()
                  .catch(() => "")
              ).trim().length,
            { timeout: 60_000 },
          )
          .toBeGreaterThan(30);
        if (scene.click) await page.getByRole("button", { name: scene.click, exact: true }).click();
        const ready = page.locator('[data-ready="true"]');
        if (await page.locator("[data-ready]").count())
          await expect(ready.first()).toBeAttached({ timeout: 60_000 });
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.waitForTimeout(600);
        const problems = await layoutProblems(page, scene.root);
        if (problems.length) {
          const label = `${scene.path}${scene.click ? `:${scene.click}` : ""}`;
          findings.push({ scene: label, problems });
          await page.screenshot({
            path: testInfo.outputPath(`${findings.length}.png`),
            fullPage: true,
            animations: "disabled",
          });
        }
      }
      await testInfo.attach("layout-findings", {
        body: JSON.stringify(findings, null, 2),
        contentType: "application/json",
      });
      expect(findings).toEqual([]);
    });
  }
}
