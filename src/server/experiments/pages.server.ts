// pages.server.ts — fetch a site's own pages as raw HTML (no JavaScript),
// through the SSRF-guarded fetcher. The live check and the "before" values
// both come from here, so they see exactly what search engines see.
import "server-only";
import { extractHtml } from "@/lib/geo/extract";
import { readFields, type PageFields } from "@/lib/experiments/fields";
import { safeFetch } from "@/server/safe-fetch";

export type FetchedPage = {
  path: string;
  url: string;
  status: number;
  /** null when the page couldn't be read (bot wall, error, not HTML). */
  fields: PageFields | null;
  firstParagraph: string | null;
  text: string;
  /** The page's canonical points to a different path. */
  canonicalElsewhere: boolean;
  problem: string | null;
};

const CONCURRENCY = 6;
const BOT_WALL = /(attention required|just a moment|verify you are human|access denied|captcha)/i;

export async function fetchPage(origin: string, path: string): Promise<FetchedPage> {
  const url = new URL(path, origin).toString();
  const base: FetchedPage = {
    path,
    url,
    status: 0,
    fields: null,
    firstParagraph: null,
    text: "",
    canonicalElsewhere: false,
    problem: null,
  };
  try {
    const res = await safeFetch(url, {
      timeoutMs: 15_000,
      maxBytes: 3_000_000,
      onOverflow: "truncate",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "MelloxProofEngine/1.0 (+https://mellox.ai)",
        "cache-control": "no-cache",
      },
    });
    base.status = res.status;
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ...base, problem: `The page answered ${res.status}.` };
    if (!type.includes("html")) return { ...base, problem: "The page isn't HTML." };
    if (res.truncated) return { ...base, problem: "The page was too large to read completely." };
    const html = res.text();
    const x = extractHtml(html);
    if (BOT_WALL.test(x.titles[0] ?? "") && x.bodyText.length < 2000) {
      return { ...base, problem: "A bot check blocked the page." };
    }
    const canonical = x.canonicals[0];
    let canonicalElsewhere = false;
    if (canonical) {
      try {
        const c = new URL(canonical, url);
        const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
        canonicalElsewhere = norm(c.pathname) !== norm(new URL(url).pathname);
      } catch {
        canonicalElsewhere = false;
      }
    }
    return {
      ...base,
      fields: readFields(html),
      firstParagraph: x.paragraphs.find((p) => p.length >= 60) ?? x.paragraphs[0] ?? null,
      text: [x.titles[0], x.metaDescriptions[0], ...x.headings.map((h) => h.text), x.mainText]
        .filter(Boolean)
        .join("\n")
        .slice(0, 20_000),
      canonicalElsewhere,
    };
  } catch (error) {
    return {
      ...base,
      problem:
        error instanceof Error
          ? `Couldn't fetch the page: ${error.message}`
          : "Couldn't fetch the page.",
    };
  }
}

export async function fetchPages(
  origin: string,
  paths: string[],
): Promise<Map<string, FetchedPage>> {
  const out = new Map<string, FetchedPage>();
  let next = 0;
  async function worker() {
    while (next < paths.length) {
      const path = paths[next++];
      out.set(path, await fetchPage(origin, path));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return out;
}

/** The value a page shows today for a field, for the "before" column. */
export function beforeValue(page: FetchedPage, field: string): string | null {
  if (!page.fields) return null;
  switch (field) {
    case "title":
      return page.fields.title;
    case "meta_description":
      return page.fields.meta_description;
    case "h1":
      return page.fields.h1;
    case "intro":
      return page.firstParagraph;
    default:
      return null;
  }
}
