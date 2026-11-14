import "server-only";
import type { BrowserContext, Page } from "playwright-core";
import { launchVisualBrowser } from "./browser.server";
import sharp from "sharp";
import { assertPublicUrl, safeFetch } from "@/server/safe-fetch";

const MAX_HEIGHT = 18_000;
const MAX_REQUESTS = 180;
const MAX_BYTES = 45 * 1024 * 1024;
export type CapturedPage = {
  url: string;
  links: string[];
  width: number;
  height: number;
  complete: boolean;
  tokens: Record<string, unknown>;
  warnings: string[];
  images: { label: string; bytes: Buffer; region: Record<string, unknown> }[];
};

/** Every document and subresource is fulfilled by the DNS/redirect guarded fetcher.
 * No cookies, credentials, forms, service workers, WebSockets or unrestricted browser fetches. */
export async function guardCaptureNetwork(context: BrowserContext) {
  let requests = 0;
  let bytes = 0;
  const cache = new Map<string, Awaited<ReturnType<typeof safeFetch>>>();
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  await context.route("**/*", async (route) => {
    const request = route.request();
    try {
      const url = assertPublicUrl(request.url());
      if (
        request.method() !== "GET" ||
        ++requests > MAX_REQUESTS ||
        bytes >= MAX_BYTES ||
        request.resourceType() === "media"
      ) {
        await route.abort();
        return;
      }
      let response = cache.get(url.href);
      if (!response) {
        response = await safeFetch(url, {
          timeoutMs: 7000,
          maxBytes: Math.min(5 * 1024 * 1024, MAX_BYTES - bytes),
          onOverflow: "error",
          headers: { "User-Agent": "Mozilla/5.0 MelloxVisualBot" },
        });
        bytes += response.bytes.length;
        if (bytes > MAX_BYTES) {
          await route.abort();
          return;
        }
        cache.set(url.href, response);
      }
      await route.fulfill({
        status: response.status,
        body: Buffer.from(response.bytes),
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/octet-stream",
          "access-control-allow-origin": "*",
        },
      });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  return () => ({ requests, bytes, limited: requests >= MAX_REQUESTS || bytes >= MAX_BYTES });
}

async function prepare(page: Page) {
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
    const decline = [...document.querySelectorAll("button")].find((button) =>
      /^(reject all|decline|only necessary|necessary only)$/i.test(
        button.textContent?.trim() ?? "",
      ),
    );
    if (decline && decline.closest('[role="dialog"], [id*="cookie"], [class*="cookie"]'))
      decline.click();
    const style = document.createElement("style");
    style.textContent =
      "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;scroll-behavior:auto!important}";
    document.head.appendChild(style);
  });
  for (let y = 0; y < MAX_HEIGHT; y += 1200) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (y >= height) break;
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** One bounded page. Browser launch failures are explicit, never fake captures. */
export async function captureVisualPage(url: string, mobile = false): Promise<CapturedPage> {
  const initial = await safeFetch(assertPublicUrl(url), {
    maxBytes: 3 * 1024 * 1024,
    timeoutMs: 8000,
    onOverflow: "error",
  });
  if (!initial.ok || !/text\/html/i.test(initial.headers.get("content-type") ?? ""))
    throw new Error("This page could not be opened for a visual scan.");
  const browser = await launchVisualBrowser();
  const deadline = setTimeout(() => void browser.close().catch(() => {}), 45_000);
  try {
    const width = mobile ? 390 : 1440;
    const context = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 1000 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "en-US",
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const network = await guardCaptureNetwork(context);
    const page = await context.newPage();
    await page.goto(initial.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await prepare(page);
    const info = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const headings = [...main.querySelectorAll("h1,h2,h3")].slice(0, 18).map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent?.slice(0, 100),
          family: s.fontFamily,
          size: s.fontSize,
          weight: s.fontWeight,
          color: s.color,
          top: r.top + scrollY,
        };
      });
      const sections = [...main.querySelectorAll("section,article")]
        .filter((el) => el.getBoundingClientRect().height > 240)
        .slice(0, 10)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            top: Math.max(0, Math.round(r.top + scrollY)),
            height: Math.round(r.height),
            background: s.backgroundColor,
            radius: s.borderRadius,
          };
        });
      return {
        height: document.documentElement.scrollHeight,
        links: [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href),
        headings,
        sections,
        background: getComputedStyle(document.body).backgroundColor,
        images: [...main.querySelectorAll("img")].slice(0, 30).map((img) => ({
          url: img.currentSrc,
          alt: img.alt,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })),
        overlays: [...document.querySelectorAll('[role="dialog"]')].filter(
          (el) => el.getBoundingClientRect().height > 0,
        ).length,
        // The artwork the site really shows: big pictures and painted
        // backgrounds, measured in page coordinates (cut from the screenshot).
        art: [...document.querySelectorAll("img,picture,svg,div,section,header,figure")]
          .flatMap((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 480 || r.height < 300) return [];
            const s = getComputedStyle(el);
            const painted = /url\(/.test(s.backgroundImage);
            const picture = el.tagName === "IMG" || el.tagName === "PICTURE";
            if (!painted && !picture) return [];
            if (s.visibility === "hidden" || Number(s.opacity) < 0.2) return [];
            return [
              {
                left: Math.max(0, Math.round(r.left + scrollX)),
                top: Math.max(0, Math.round(r.top + scrollY)),
                width: Math.round(r.width),
                height: Math.round(r.height),
                alt: (el as HTMLImageElement).alt?.slice(0, 120) ?? "",
              },
            ];
          })
          .sort((a, b) => b.width * b.height - a.width * a.height)
          .slice(0, 12),
        // Design tokens the way open-source extractors read them: CSS custom
        // properties for colour and type, the loaded font faces and the buttons.
        cssVars: (() => {
          const out: Record<string, string> = {};
          const root = getComputedStyle(document.documentElement);
          for (const sheet of [...document.styleSheets]) {
            let rules: CSSRuleList | null = null;
            try {
              rules = sheet.cssRules;
            } catch {
              continue;
            }
            for (const rule of [...rules]) {
              const style = (rule as CSSStyleRule).style;
              if (!style || !/^(:root|html|body)$/.test((rule as CSSStyleRule).selectorText ?? ""))
                continue;
              for (const name of [...style])
                if (
                  name.startsWith("--") &&
                  /(color|colour|bg|brand|accent|primary|font|ink)/i.test(name)
                )
                  out[name] = root.getPropertyValue(name).trim().slice(0, 80);
              if (Object.keys(out).length >= 40) return out;
            }
          }
          return out;
        })(),
        fonts: [
          ...new Set(
            [...document.fonts]
              .filter((f) => f.status === "loaded")
              .map((f) => `${f.family.replace(/["']/g, "")} ${f.style} ${f.weight}`),
          ),
        ].slice(0, 16),
        buttons: [
          ...document.querySelectorAll("button,a[class*='btn'],a[class*='button'],[role='button']"),
        ]
          .filter((el) => el.getBoundingClientRect().width > 40)
          .slice(0, 4)
          .map((el) => {
            const s = getComputedStyle(el);
            return {
              text: el.textContent?.trim().slice(0, 40),
              background: s.backgroundColor,
              color: s.color,
              radius: s.borderRadius,
              font: s.fontFamily.slice(0, 80),
            };
          }),
      };
    });
    const height = Math.min(MAX_HEIGHT, info.height);
    const screenshot = await page.screenshot({
      type: "png",
      fullPage: true,
      clip: { x: 0, y: 0, width, height },
      timeout: 12_000,
    });
    const full = Buffer.from(screenshot);
    const regions = [0, ...info.sections.map((s) => s.top), Math.max(0, height - 1000)];
    const tops = [...new Set(regions)]
      .filter(
        (top, i, all) =>
          top < height && !all.slice(0, i).some((previous) => Math.abs(previous - top) < 700),
      )
      .slice(0, mobile ? 2 : 4);
    const images: CapturedPage["images"] = [
      {
        label: mobile ? "Mobile page" : "Full page",
        bytes: full,
        region: { type: "full", width, height, mobile },
      },
    ];
    for (const [index, top] of tops.entries()) {
      images.push({
        label: index === 0 ? "Hero" : `Section ${index + 1}`,
        bytes: await sharp(full)
          .extract({ left: 0, top, width, height: Math.min(1000, height - top) })
          .png()
          .toBuffer(),
        region: { type: "section", top, width, height: Math.min(1000, height - top), mobile },
      });
    }
    let artCount = 0;
    for (const box of pickArtBoxes(info.art, width, height, mobile ? 2 : 6)) {
      if (artCount >= (mobile ? 1 : 4)) break;
      const crop = sharp(full).extract({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      });
      // A painted background with nothing on it teaches nothing: skip flat crops.
      const { channels } = await crop.clone().stats();
      if (!hasDetail(channels.slice(0, 3).map((c) => c.stdev))) continue;
      artCount += 1;
      images.push({
        label: `Artwork ${artCount}`,
        bytes: await crop.png().toBuffer(),
        region: { type: "art", ...box, mobile, alt: box.alt },
      });
    }
    const complete = info.height <= MAX_HEIGHT && !network().limited;
    const warnings = [
      !complete
        ? "This page exceeded the scan limit. The saved capture covers its first sections."
        : "",
      info.overlays ? "An overlay may obscure part of this page." : "",
    ].filter(Boolean);
    return {
      url: page.url(),
      links: info.links,
      width,
      height,
      complete,
      tokens: {
        headings: info.headings,
        sections: info.sections,
        background: info.background,
        images: info.images,
        cssVars: info.cssVars,
        fonts: info.fonts,
        buttons: info.buttons,
      },
      warnings,
      images,
    };
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}

type ArtBox = { left: number; top: number; width: number; height: number; alt: string };

/**
 * The site's largest distinct pictures, clipped to the captured page and kept
 * apart from each other (a nested element over the same picture counts once).
 */
export function pickArtBoxes(
  boxes: ArtBox[],
  width: number,
  height: number,
  max: number,
): ArtBox[] {
  const kept: ArtBox[] = [];
  for (const raw of boxes) {
    const left = Math.max(0, Math.min(raw.left, width - 1));
    const top = Math.max(0, Math.min(raw.top, height - 1));
    const box = {
      left,
      top,
      width: Math.min(raw.width, width - left),
      height: Math.min(raw.height, height - top, 1400),
      alt: raw.alt,
    };
    if (box.width < 480 || box.height < 300) continue;
    const overlaps = kept.some((k) => {
      const x = Math.max(
        0,
        Math.min(k.left + k.width, box.left + box.width) - Math.max(k.left, box.left),
      );
      const y = Math.max(
        0,
        Math.min(k.top + k.height, box.top + box.height) - Math.max(k.top, box.top),
      );
      return x * y > 0.5 * Math.min(k.width * k.height, box.width * box.height);
    });
    if (!overlaps) kept.push(box);
    if (kept.length >= max) break;
  }
  return kept;
}

/** A crop with real content: some spread of tones in at least one colour channel. */
export function hasDetail(stdevs: number[]): boolean {
  return stdevs.some((d) => d >= 14);
}
