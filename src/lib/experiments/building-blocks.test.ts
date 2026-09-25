import { describe, expect, it } from "vitest";
import { aiReferrerOf } from "./ai-referrers";
import {
  checkFieldValue,
  conflictingPaths,
  emptyOverrides,
  integrationPaths,
  parseOverrides,
  readerModuleSource,
  serializeOverrides,
  withEntry,
} from "./datafile";
import { showsValue, unchangedFrom, readFields } from "./fields";
import {
  clusterPages,
  findTemplateFile,
  matchesPattern,
  normalizePath,
  templateFrameworkFor,
} from "./groups";
import { experimentBranchName, isMelloxBranch } from "@/server/connectors/github/paths";

describe("normalizePath", () => {
  it("keeps the path only, without trailing slash, query or fragment", () => {
    expect(normalizePath("https://shop.example.com/products/red-shoe/?utm=x#top")).toBe(
      "/products/red-shoe",
    );
    expect(normalizePath("products//a")).toBe("/products/a");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBeNull();
  });
});

describe("clusterPages", () => {
  const products = Array.from({ length: 12 }, (_, i) => ({
    path: `/products/item-${i}`,
    clicks: 10 + i,
    impressions: 100,
  }));
  const blog = Array.from({ length: 9 }, (_, i) => ({
    path: `/blog/post-${i}/`,
    clicks: 2,
    impressions: 50,
  }));

  it("groups similar pages by one varying segment", () => {
    const groups = clusterPages([...products, ...blog, { path: "/", clicks: 999, impressions: 1 }]);
    expect(groups.map((g) => g.pattern)).toEqual(["/products/*", "/blog/*"]);
    expect(groups[0].paths).toHaveLength(12);
    expect(groups[0].label).toBe("Products pages");
    expect(groups[1].paths.every((p) => !p.endsWith("/"))).toBe(true);
  });

  it("drops groups that are too small and never includes the home page or files", () => {
    const groups = clusterPages([
      ...products.slice(0, 5),
      { path: "/sitemap.xml", clicks: 1, impressions: 1 },
    ]);
    expect(groups).toEqual([]);
  });

  it("merges duplicate paths", () => {
    const groups = clusterPages([
      ...products,
      { path: "/products/item-0/", clicks: 5, impressions: 5 },
    ]);
    expect(groups[0].paths).toHaveLength(12);
    expect(groups[0].clicks).toBe(products.reduce((s, p) => s + p.clicks, 0) + 5);
  });

  it("matches patterns segment by segment", () => {
    expect(matchesPattern("/products/a", "/products/*")).toBe(true);
    expect(matchesPattern("/products/a/b", "/products/*")).toBe(false);
  });
});

describe("findTemplateFile", () => {
  it("finds a Next.js App Router dynamic route, ignoring route groups", () => {
    const paths = ["app/(shop)/products/[slug]/page.tsx", "app/page.tsx", "app/layout.tsx"];
    const fw = templateFrameworkFor("Next.js", paths);
    expect(fw).toBe("next-app");
    expect(findTemplateFile("/products/*", paths, fw)).toBe("app/(shop)/products/[slug]/page.tsx");
  });

  it("finds Pages Router, Astro, Nuxt, SvelteKit and Remix routes", () => {
    expect(findTemplateFile("/blog/*", ["pages/blog/[id].tsx"], "next-pages")).toBe(
      "pages/blog/[id].tsx",
    );
    expect(findTemplateFile("/blog/*", ["src/pages/blog/[slug].astro"], "astro")).toBe(
      "src/pages/blog/[slug].astro",
    );
    expect(findTemplateFile("/blog/*", ["pages/blog/[slug].vue"], "nuxt")).toBe(
      "pages/blog/[slug].vue",
    );
    expect(findTemplateFile("/blog/*", ["src/routes/blog/[slug]/+page.svelte"], "sveltekit")).toBe(
      "src/routes/blog/[slug]/+page.svelte",
    );
    expect(findTemplateFile("/blog/*", ["app/routes/blog.$slug.tsx"], "remix")).toBe(
      "app/routes/blog.$slug.tsx",
    );
  });

  it("returns null when no route renders the pattern, and prefers the shallowest", () => {
    expect(findTemplateFile("/products/*", ["app/about/page.tsx"], "next-app")).toBeNull();
    expect(
      findTemplateFile("/p/*", ["apps/web/app/p/[id]/page.tsx", "app/p/[id]/page.tsx"], "next-app"),
    ).toBe("app/p/[id]/page.tsx");
    expect(templateFrameworkFor("Hugo", [])).toBeNull();
  });
});

describe("overrides data file", () => {
  it("serialises deterministically, so the approved hash is exact", () => {
    const a = withEntry(emptyOverrides(), "e2", {
      field: "title",
      pages: { "/b": "B", "/a": "A" },
    });
    const b = withEntry(
      withEntry(emptyOverrides(), "e2", { field: "title", pages: { "/a": "A", "/b": "B" } }),
      "e1",
      null,
    );
    expect(serializeOverrides(a)).toBe(serializeOverrides(b));
    expect(serializeOverrides(a).endsWith("\n")).toBe(true);
  });

  it("round-trips and refuses malformed files instead of overwriting them", () => {
    const text = serializeOverrides(
      withEntry(emptyOverrides(), "e1", { field: "h1", pages: { "/x": "Hello" } }),
    );
    const parsed = parseOverrides(text);
    expect(parsed.ok && parsed.file.experiments.e1.pages["/x"]).toBe("Hello");
    expect(parseOverrides(null)).toEqual({ ok: true, file: emptyOverrides() });
    expect(parseOverrides("{not json").ok).toBe(false);
    expect(parseOverrides('{"version":2,"experiments":{}}').ok).toBe(false);
    expect(parseOverrides('{"version":1,"experiments":{"x":{"field":"nope","pages":{}}}}').ok).toBe(
      false,
    );
  });

  it("removes an entry on rollback and spots pages another test already changes", () => {
    const file = withEntry(emptyOverrides(), "e1", { field: "title", pages: { "/a": "A" } });
    expect(withEntry(file, "e1", null).experiments).toEqual({});
    expect(
      conflictingPaths(file, "e2", { field: "title", pages: { "/a": "Z", "/b": "B" } }),
    ).toEqual(["/a"]);
    expect(conflictingPaths(file, "e2", { field: "h1", pages: { "/a": "Z" } })).toEqual([]);
  });

  it("checks values in plain words", () => {
    expect(checkFieldValue("title", "Red running shoes for trail runs")).toEqual([]);
    expect(checkFieldValue("title", "Short")[0]).toMatch(/10–70/);
    expect(checkFieldValue("title", "A <b>bold</b> title for a page")[0]).toMatch(/HTML/);
    expect(checkFieldValue("faq", [{ question: "Q?", answer: "A" }])[0]).toMatch(/2–6/);
  });

  it("places the reader and data file in the app root, with a working import", () => {
    expect(integrationPaths("", true)).toEqual({
      reader: "src/mellox/experiments.ts",
      dataFile: "mellox-experiments/overrides.json",
      importPath: "../../mellox-experiments/overrides.json",
    });
    expect(integrationPaths("apps/web", false)).toEqual({
      reader: "apps/web/mellox/experiments.ts",
      dataFile: "apps/web/mellox-experiments/overrides.json",
      importPath: "../mellox-experiments/overrides.json",
    });
    const src = readerModuleSource("../mellox-experiments/overrides.json");
    expect(src).toContain('import data from "../mellox-experiments/overrides.json"');
    expect(src).toContain("export function melloxOverride(");
  });
});

describe("page fields", () => {
  const html = `<html><head><title>Red shoe &amp; more</title>
    <meta name="description" content="Buy the red shoe."></head>
    <body><h1>Red shoe</h1><p>Our lightest trail shoe yet, made for long runs.</p>
    <a class="btn">Buy now</a></body></html>`;
  const fields = readFields(html);

  it("reads head fields and matches values the way a visitor sees them", () => {
    expect(fields.title).toBe("Red shoe & more");
    expect(showsValue(fields, "title", "Red shoe & more")).toBe(true);
    expect(showsValue(fields, "title", "Blue shoe")).toBe(false);
    expect(showsValue(fields, "cta_text", "Buy now")).toBe(true);
    expect(showsValue(fields, "intro", "Our lightest trail shoe yet, made for long runs.")).toBe(
      true,
    );
  });

  it("tells whether a comparison page is unchanged", () => {
    expect(unchangedFrom(fields, "h1", "Red shoe")).toBe(true);
    expect(unchangedFrom(fields, "h1", "Something else")).toBe(false);
    expect(unchangedFrom(fields, "h1", null)).toBeNull();
  });
});

describe("AI referrers", () => {
  it("recognises assistants and ignores search engines", () => {
    expect(aiReferrerOf("chatgpt.com")).toBe("chatgpt");
    expect(aiReferrerOf("www.perplexity.ai")).toBe("perplexity");
    expect(aiReferrerOf("gemini.google.com")).toBe("gemini");
    expect(aiReferrerOf("google")).toBeNull();
    expect(aiReferrerOf("(direct)")).toBeNull();
    expect(aiReferrerOf(null)).toBeNull();
  });
});

describe("experiment branches", () => {
  it("are Mellox branches under mellox/exp-", () => {
    const b = experimentBranchName("ship", "0f3a9c21", "a1b2c3d4");
    expect(b).toBe("mellox/exp-ship-0f3a9c21-a1b2c3");
    expect(isMelloxBranch(b)).toBe(true);
  });
});
