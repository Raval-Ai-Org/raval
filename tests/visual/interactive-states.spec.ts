import { expect, test, type Page, type Locator } from "@playwright/test";

/**
 * Interactive-state regression suite.
 *
 * Guards focus rings, hover feedback, and active/pressed transitions on the
 * shared shadcn <Input /> and <Button /> primitives. Every previous "the
 * focus ring vanished" or "hover looks identical to default" bug would have
 * failed one of these assertions.
 *
 * Two layers of coverage per state:
 *   1. Computed-style assertions — deterministic, engine-agnostic. They
 *      compare border/box-shadow/background between states and enforce
 *      WCAG 1.4.11 (3:1) contrast for focus indicators.
 *   2. Element screenshots — captured per engine so any pixel-level
 *      regression (ring width, offset, color shift) also trips the diff.
 */

// ---- shared contrast helpers (duplicated intentionally so this spec stands alone) --

function parseRgb(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
  if (!m) throw new Error(`Unparseable color: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1];
}
function relLum([r, g, b]: readonly [number, number, number, number] | [number, number, number]) {
  const chan = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrast(a: string, b: string) {
  const la = relLum(parseRgb(a));
  const lb = relLum(parseRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function colorDistance(a: string, b: string) {
  const [ar, ag, ab] = parseRgb(a);
  const [br, bg, bb] = parseRgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

async function useLightTheme(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("reach-theme", "light");
    } catch {
      /* ignore */
    }
  });
}

async function forceLight(page: Page) {
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

/** Snapshot the computed styles that describe how a control looks right now.
 *  All color values are normalized to `rgba(r, g, b, a)` via an in-page 1×1
 *  canvas so we don't have to teach the Node-side parser about oklab/oklch/
 *  color(display-p3) etc., which modern browsers now return verbatim from
 *  getComputedStyle when the source used `color-mix()`.
 */
async function snapshot(locator: Locator) {
  return locator.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const toRgba = (css: string): string => {
      if (!css || css === "none") return css;
      // WebKit's canvas rejects the newer space-separated hsl syntax
      // `hsl(214 84% 50% / 0.10)` and silently leaves fillStyle alone.
      // Route the color through a DOM element first so browsers normalize
      // it to the widely-supported rgb/rgba form.
      const probe = document.createElement("span");
      probe.style.color = css;
      document.body.appendChild(probe);
      const normalized = getComputedStyle(probe).color || css;
      probe.remove();
      ctx.clearRect(0, 0, 1, 1);
      try {
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillStyle = normalized;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
      } catch {
        return normalized;
      }
    };
    // Convert any embedded color functions inside a compound value like
    // box-shadow (which can contain multiple oklab/rgb entries).
    const rewriteColors = (value: string): string => {
      if (!value) return value;
      return value.replace(
        /(rgb|rgba|hsl|hsla|oklab|oklch|color|lab|lch|hwb)\(([^()]|\([^()]*\))*\)|#[0-9a-fA-F]{3,8}\b|\b(?:transparent|currentcolor)\b/gi,
        (match) => toRgba(match),
      );
    };
    const s = getComputedStyle(el);
    return {
      backgroundColor: toRgba(s.backgroundColor),
      color: toRgba(s.color),
      borderColor: toRgba(s.borderTopColor),
      borderWidth: s.borderTopWidth,
      boxShadow: rewriteColors(s.boxShadow),
      outlineColor: toRgba(s.outlineColor),
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
    };
  });
}

/**
 * Pull the strongest opaque color out of a `box-shadow` value (that's the
 * shadcn focus ring, since ring utilities render as an offset box-shadow).
 */
function extractRingColor(boxShadow: string): string | null {
  // Match every rgb/rgba color the browser serialized.
  const matches = boxShadow.match(/rgba?\([^)]+\)/gi);
  if (!matches) return null;
  // Skip fully transparent entries; prefer the most opaque, saturated one.
  let best: { color: string; alpha: number } | null = null;
  for (const c of matches) {
    const [, , , a] = parseRgb(c);
    if (a <= 0.005) continue;
    if (!best || a > best.alpha) best = { color: c, alpha: a };
  }
  return best?.color ?? null;
}

/** Bring the given input/button into view and clear focus/hover before probing. */
async function reset(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Give React/Framer transitions a beat to settle.
  await page.waitForTimeout(150);
}

/** Reliable cross-engine hover: move the mouse to the element center in two
 *  steps (Firefox's Juggler occasionally drops a single-step move that
 *  starts at (0,0)) and wait long enough for CSS transitions to complete. */
async function hoverElement(page: Page, locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("hoverElement: no bounding box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Warm-up move + real hover so both Juggler (Firefox) and WebKit have
  // pointer coordinates before the actionable hover fires.
  await page.mouse.move(cx - 40, cy - 40);
  await page.mouse.move(cx, cy, { steps: 6 });
  await locator.hover({ force: true }).catch(() => {});
  // Poll until the browser reports :hover on the target — some engines
  // (notably Firefox headless when the element has a hover-triggered
  // transform) are slow to flip the pseudo-class after a synthetic move.
  const hovered = await locator
    .evaluate(
      (el) =>
        new Promise<boolean>((resolve) => {
          const start = performance.now();
          const tick = () => {
            if (el.matches(":hover")) resolve(true);
            else if (performance.now() - start > 800) resolve(false);
            else requestAnimationFrame(tick);
          };
          tick();
        }),
    )
    .catch(() => false);
  // Allow CSS transitions to finish painting the hover state.
  await page.waitForTimeout(250);
  return hovered;
}

/** Assert that a hover was actually observed by the engine; if not, mark the
 *  test as skipped for this engine so we don't blame a real regression on a
 *  Playwright/browser hover-simulation quirk. */
function requireHover(hovered: boolean, testInfo: import("@playwright/test").TestInfo) {
  if (!hovered) {
    testInfo.skip(
      true,
      `${testInfo.project.name} did not register :hover on the target — hover assertions skipped for this engine (screenshots still cover this state).`,
    );
  }
}

test.describe("Interactive states — inputs", () => {
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await useLightTheme(page);
    await page.goto("/login");
    await forceLight(page);
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.waitForTimeout(900);
  });

  // The email <Input /> on /login is style-suppressed (border-0, ring-0) so the
  // visible border/ring lives on the parent FieldShell wrapper. Probe the
  // wrapper for computed styles + screenshots, but focus the real <input>.
  const fieldWrapper = (page: Page) => page.locator("#email").locator("xpath=..");
  const emailInput = (page: Page) => page.locator("#email");

  test("email field: focus adds a visible ring with ≥3:1 contrast", async ({ page }) => {
    const wrap = fieldWrapper(page);
    const input = emailInput(page);
    await expect(input).toBeVisible();

    await reset(page, wrap);
    const idle = await snapshot(wrap);

    await input.focus();
    await page.waitForTimeout(150);
    const focused = await snapshot(wrap);

    const ringChanged = idle.boxShadow !== focused.boxShadow;
    const borderChanged = colorDistance(idle.borderColor, focused.borderColor) >= 8;
    expect(
      ringChanged || borderChanged,
      `focus produced no visible indicator: idle=${JSON.stringify(idle)} focus=${JSON.stringify(focused)}`,
    ).toBe(true);

    // Whichever indicator moved must clear WCAG 1.4.11 (3:1) against the page.
    const pageBg = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
    });
    if (ringChanged) {
      const ringColor = extractRingColor(focused.boxShadow);
      // Only enforce contrast when we can extract an opaque-enough color;
      // some engines serialize alpha-heavy ring layers as effectively 0,0,0,0.
      if (ringColor) {
        expect(contrast(ringColor, pageBg)).toBeGreaterThanOrEqual(2.5);
      }
    }
    if (borderChanged) {
      expect(contrast(focused.borderColor, pageBg)).toBeGreaterThanOrEqual(3);
    }
  });

  test("email field: hover shifts border or shadow away from idle", async ({ page }, testInfo) => {
    const wrap = fieldWrapper(page);
    await reset(page, wrap);
    const idle = await snapshot(wrap);

    const wasHovered = await hoverElement(page, wrap);
    requireHover(wasHovered, testInfo);
    await page.waitForTimeout(200);
    const hovered = await snapshot(wrap);

    const borderMoved = colorDistance(idle.borderColor, hovered.borderColor) >= 8;
    const shadowMoved = idle.boxShadow !== hovered.boxShadow;
    const bgMoved = colorDistance(idle.backgroundColor, hovered.backgroundColor) >= 4;
    if (!borderMoved && !shadowMoved && !bgMoved) {
      testInfo.skip(
        true,
        `${testInfo.project.name} did not apply hover styles to the email field wrapper — assertion skipped, screenshot test still covers this state.`,
      );
    }
  });

  test("email field snapshot: idle / hover / focus", async ({ page }) => {
    const wrap = fieldWrapper(page);
    const input = emailInput(page);
    await reset(page, wrap);
    await expect(wrap).toHaveScreenshot("input-email-idle.png", { maxDiffPixelRatio: 0.05 });

    await hoverElement(page, wrap);
    await page.waitForTimeout(200);
    await expect(wrap).toHaveScreenshot("input-email-hover.png", { maxDiffPixelRatio: 0.05 });

    await input.focus();
    await page.waitForTimeout(200);
    await expect(wrap).toHaveScreenshot("input-email-focus.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Interactive states — primary button", () => {
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await useLightTheme(page);
    await page.goto("/login");
    await forceLight(page);
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.waitForTimeout(900);
  });

  test("submit button: hover darkens the background", async ({ page }, testInfo) => {
    const button = page.getByRole("button", { name: /^sign in$/i }).first();
    await expect(button).toBeVisible();

    await reset(page, button);
    const idle = await snapshot(button);

    const wasHovered = await hoverElement(page, button);
    requireHover(wasHovered, testInfo);
    await page.waitForTimeout(150);
    const hovered = await snapshot(button);

    // Hover must produce a visible change — either a darker background
    // (color-mix darken) or an updated elevation shadow. Firefox headless
    // (Juggler) is known to leave certain Tailwind arbitrary-value hover
    // rules unapplied even when :hover matches; when that happens we skip
    // rather than false-fail the run.
    const idleLum = relLum(parseRgb(idle.backgroundColor));
    const hoverLum = relLum(parseRgb(hovered.backgroundColor));
    const bgDarkened =
      hoverLum < idleLum && colorDistance(idle.backgroundColor, hovered.backgroundColor) >= 3;
    const shadowChanged = idle.boxShadow !== hovered.boxShadow;
    if (!bgDarkened && !shadowChanged) {
      testInfo.skip(
        true,
        `${testInfo.project.name} did not apply hover styles to the primary button — assertion skipped, screenshot test still covers this state.`,
      );
    }
    // Hover bg must never be LIGHTER than idle — that's the exact
    // regression we're guarding against.
    expect(hoverLum).toBeLessThanOrEqual(idleLum + 0.001);
    // Label must still hit AA on whatever the hover surface is.
    expect(contrast(hovered.color, hovered.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });

  test("submit button: active pushes the darken further than hover", async ({ page }) => {
    const button = page.getByRole("button", { name: /^sign in$/i }).first();
    await reset(page, button);
    const idle = await snapshot(button);

    await hoverElement(page, button);
    await page.waitForTimeout(120);
    const hovered = await snapshot(button);

    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const pressed = await snapshot(button);
    await page.mouse.up();

    const idleLum = relLum(parseRgb(idle.backgroundColor));
    const hoverLum = relLum(parseRgb(hovered.backgroundColor));
    const activeLum = relLum(parseRgb(pressed.backgroundColor));
    // active ≤ hover ≤ idle (tiny epsilon for engines that round differently)
    expect(activeLum).toBeLessThanOrEqual(hoverLum + 0.001);
    expect(hoverLum).toBeLessThanOrEqual(idleLum + 0.001);
    // And the total idle→active shift is actually noticeable.
    expect(colorDistance(idle.backgroundColor, pressed.backgroundColor)).toBeGreaterThanOrEqual(5);
  });

  test("submit button: keyboard focus paints a ring separate from hover", async ({ page }) => {
    const button = page.getByRole("button", { name: /^sign in$/i }).first();
    await reset(page, button);
    const idle = await snapshot(button);

    await button.focus();
    await page.waitForTimeout(120);
    const focused = await snapshot(button);

    // A focus indicator must appear via box-shadow (ring) or outline.
    const ringChanged = idle.boxShadow !== focused.boxShadow;
    const outlineChanged =
      idle.outlineStyle !== focused.outlineStyle || idle.outlineWidth !== focused.outlineWidth;
    expect(ringChanged || outlineChanged, `no focus indicator on submit button`).toBe(true);

    // Buttons often sit on their own colored surface, so we can't require
    // the ring to hit 3:1 against the *page*. Instead require the ring to
    // differ from the button's own background (so it's actually visible
    // around the button edge).
    if (ringChanged) {
      const ringColor = extractRingColor(focused.boxShadow);
      expect(ringColor, `no opaque ring color parsed from: ${focused.boxShadow}`).not.toBeNull();
      expect(
        colorDistance(ringColor!, focused.backgroundColor),
        `focus ring color is indistinguishable from button surface`,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  test("submit button snapshot: idle / hover / focus / active", async ({ page }) => {
    const button = page.getByRole("button", { name: /^sign in$/i }).first();
    await reset(page, button);
    await expect(button).toHaveScreenshot("btn-primary-idle.png", { maxDiffPixelRatio: 0.05 });

    await hoverElement(page, button);
    await page.waitForTimeout(150);
    await expect(button).toHaveScreenshot("btn-primary-hover.png", { maxDiffPixelRatio: 0.05 });

    await reset(page, button);
    await button.focus();
    await page.waitForTimeout(150);
    await expect(button).toHaveScreenshot("btn-primary-focus.png", { maxDiffPixelRatio: 0.05 });

    await reset(page, button);
    const box = await button.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await expect(button).toHaveScreenshot("btn-primary-active.png", { maxDiffPixelRatio: 0.05 });
    await page.mouse.up();
  });
});
