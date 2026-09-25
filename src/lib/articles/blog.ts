// blog.ts — where a website keeps its articles, decided from what the
// platform really returns (pure; no network):
//
//   Webflow  the CMS collection that looks like a blog, and which of its fields
//            take the title, slug, body, summary and meta description
//   GitHub   the folder existing posts live in, their format, and the
//            frontmatter keys they use, so a new post matches its neighbours
//
// Nothing here guesses a field or folder that isn't there: no match is null,
// and the UI asks the person to set a blog up instead.

import type { PublishableArticle } from "./render";

/* ───────────────────────── Webflow ───────────────────────── */

export type WebflowFieldLike = {
  slug: string;
  type: string;
  displayName?: string;
  isRequired?: boolean;
};
export type WebflowCollectionLike = {
  id: string;
  slug?: string;
  displayName?: string;
  singularName?: string;
  fields?: WebflowFieldLike[];
};

/** Article part → the collection field slug that stores it. */
export type WebflowFieldMap = {
  name: string;
  slug: string;
  body: string;
  summary: string | null;
  metaDescription: string | null;
  faq: string | null;
  /** Required fields Mellox can't fill (a reference, an image…): publishing would fail. */
  unfillable: string[];
};

const BLOGGY = /\b(blog|posts?|articles?|news|insights?|journal|stories|resources|guides?)\b/i;
const FILLABLE = new Set(["PlainText", "RichText", "DateTime", "Switch"]);

function pick(fields: WebflowFieldLike[], type: string, re: RegExp): string | null {
  const f = fields.find(
    (x) => x.type === type && (re.test(x.slug) || re.test(x.displayName ?? "")),
  );
  return f?.slug ?? null;
}

export function webflowFieldMap(c: WebflowCollectionLike): WebflowFieldMap | null {
  const fields = c.fields ?? [];
  const rich = fields.filter((f) => f.type === "RichText");
  if (!rich.length) return null;
  const body =
    pick(
      fields,
      "RichText",
      /^(post-body|body|content|post-content|article-body|main-content)$/i,
    ) ?? rich[0].slug;
  const faq = pick(fields, "RichText", /faq/i);
  const summary = pick(fields, "PlainText", /summary|excerpt|intro|dek|subtitle|post-summary/i);
  const metaDescription = pick(fields, "PlainText", /meta[-\s]?description|seo[-\s]?description/i);
  const used = new Set(["name", "slug", body, summary, metaDescription, faq].filter(Boolean));
  const unfillable = fields
    .filter((f) => f.isRequired && !used.has(f.slug) && !FILLABLE.has(f.type))
    .map((f) => f.displayName ?? f.slug);
  return {
    name: "name",
    slug: "slug",
    body,
    summary,
    metaDescription,
    faq: faq === body ? null : faq,
    unfillable,
  };
}

/** The collection that is the site's blog, preferring one named like a blog. */
export function pickWebflowBlogCollection(
  collections: WebflowCollectionLike[],
): { collection: WebflowCollectionLike; map: WebflowFieldMap } | null {
  const scored = collections
    .map((collection) => ({ collection, map: webflowFieldMap(collection) }))
    .filter((x): x is { collection: WebflowCollectionLike; map: WebflowFieldMap } => !!x.map)
    .map((x) => {
      const label = `${x.collection.slug ?? ""} ${x.collection.displayName ?? ""}`;
      const score =
        (BLOGGY.test(label) ? 10 : 0) +
        (x.map.summary ? 2 : 0) +
        (x.map.metaDescription ? 1 : 0) -
        x.map.unfillable.length * 5;
      return { ...x, score };
    })
    .filter((x) => x.score >= 10 && x.map.unfillable.length === 0)
    .sort((a, b) => b.score - a.score);
  return scored[0] ? { collection: scored[0].collection, map: scored[0].map } : null;
}

/** Webflow collection items are served at /<collection slug>/<item slug>. */
export function webflowItemUrl(origin: string, collectionSlug: string, itemSlug: string): string {
  return `${origin.replace(/\/+$/, "")}/${collectionSlug}/${itemSlug}`;
}

/* ───────────────────────── GitHub ───────────────────────── */

export type PostFormat = "md" | "mdx";
export type GithubBlogLayout = {
  contentDir: string;
  format: PostFormat;
  routePrefix: string;
  examples: string[];
};

const CONTENT_DIRS = [
  /^(src\/)?content\/(blog|posts|articles)$/,
  /^(src\/)?(data|app|pages)\/(blog|posts)$/,
  /^_posts$/,
  /^(posts|blog|articles)$/,
  /^(src\/)?content\/(docs\/)?blog$/,
];

/** The folder most existing posts live in (≥ 1 markdown file directly inside). */
export function detectGithubBlog(paths: string[]): GithubBlogLayout | null {
  const byDir = new Map<string, string[]>();
  for (const p of paths) {
    const m = /^(.*)\/([^/]+)\.(mdx?|markdown)$/i.exec(p);
    if (!m) continue;
    const dir = m[1];
    if (!CONTENT_DIRS.some((re) => re.test(dir))) continue;
    if (/readme/i.test(m[2])) continue;
    byDir.set(dir, [...(byDir.get(dir) ?? []), p]);
  }
  const best = [...byDir.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) return null;
  const [contentDir, files] = best;
  const mdx = files.filter((f) => f.toLowerCase().endsWith(".mdx")).length;
  const leaf = contentDir.split("/").pop()!;
  return {
    contentDir,
    format: mdx > files.length / 2 ? "mdx" : "md",
    routePrefix: `/${leaf === "_posts" ? "blog" : leaf}`,
    examples: files.slice(0, 3),
  };
}

/** Top-level frontmatter keys of an existing post, in order. */
export function frontmatterKeys(source: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/^([A-Za-z_][\w-]*)\s*:/gm)].map((x) => x[1]);
}

const yaml = (s: string) => JSON.stringify(s);

/** A post file shaped like its neighbours; only keys the site already uses (plus title). */
export function githubPostFile(
  a: PublishableArticle,
  layout: Pick<GithubBlogLayout, "contentDir" | "format">,
  keys: string[],
  date: string,
): { path: string; content: string } {
  const has = (k: string) => keys.includes(k);
  const fm: string[] = [`title: ${yaml(a.title)}`];
  const desc = ["description", "excerpt", "summary", "metaDescription"].find(has);
  if (desc) fm.push(`${desc}: ${yaml(a.metaDescription)}`);
  const dateKey =
    ["date", "pubDate", "publishDate", "publishedAt", "published"].find(has) ?? "date";
  fm.push(`${dateKey}: ${yaml(date.slice(0, 10))}`);
  if (has("slug")) fm.push(`slug: ${yaml(a.slug)}`);
  if (has("tags") && a.tags.length) fm.push(`tags: [${a.tags.map(yaml).join(", ")}]`);
  if (a.category) {
    if (has("category")) fm.push(`category: ${yaml(a.category)}`);
    else if (has("categories")) fm.push(`categories: [${yaml(a.category)}]`);
  }
  if (has("draft")) fm.push("draft: false");
  const body: string[] = [];
  if (a.takeaways.length)
    body.push(`## Key takeaways\n\n${a.takeaways.map((t) => `- ${t}`).join("\n")}`);
  body.push(a.markdown.replace(/^#\s+.+\n+/, "").trim());
  if (a.faq.length)
    body.push(
      `## Frequently asked questions\n\n${a.faq.map((f) => `### ${f.question}\n\n${f.answer}`).join("\n\n")}`,
    );
  return {
    path: `${layout.contentDir}/${a.slug}.${layout.format}`,
    content: `---\n${fm.join("\n")}\n---\n\n${body.join("\n\n")}\n`,
  };
}
