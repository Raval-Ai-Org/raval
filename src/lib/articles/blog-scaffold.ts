// blog-scaffold.ts — add a blog to a website repository that has none (pure;
// no network). Used when a GitHub-built site has no posts folder.
//
//   plan      which framework builds the site and where a blog's files go.
//             Supported: TanStack Start and the Next.js App Router, with
//             TypeScript and Tailwind. Anything else is "unsupported" and the
//             person's developer adds the blog.
//   chrome    the site's own header and footer, found from the home page's
//             imports, so blog pages wear the same ones
//   design    class names for the new pages. A model may propose them from the
//             site's source; every value is checked here and falls back to a
//             plain default. The model never writes code.
//   files     the pages, written from fixed templates. Posts are one JSON file
//             each (rendered HTML + structured data), so no dependency is added
//             and no configuration file is touched.
//   manifest  mellox-blog.json at the repository root: how Mellox finds the
//             blog again after the pull request is merged.

export type BlogFramework = "tanstack-start" | "next-app";

export const BLOG_MANIFEST_PATH = "mellox-blog.json";
export const BLOG_ROUTE_PREFIX = "/blog";

export type ScaffoldPlan = {
  framework: BlogFramework;
  /** Folder that holds the route files ("src/routes", "app", "src/app"). */
  routesDir: string;
  homeFile: string | null;
  layoutFile: string | null;
  contentDir: string;
  libFile: string;
  indexFile: string;
  postFile: string;
  /** Next.js major version (page params are a Promise from 15). */
  nextMajor: number | null;
};

export type PlanResult = { plan: ScaffoldPlan } | { unsupported: string };

const CANT = "Mellox can't add a blog to this kind of site yet.";
const ASK = "Ask your developer to add one, then check again.";

function dependencies(packageJson: string | null): Record<string, string> {
  if (!packageJson) return {};
  try {
    const pkg = JSON.parse(packageJson) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of ["dependencies", "devDependencies"]) {
      const block = pkg[key];
      if (block && typeof block === "object")
        for (const [name, version] of Object.entries(block as Record<string, unknown>))
          if (typeof version === "string") out[name] = version;
    }
    return out;
  } catch {
    return {};
  }
}

const firstExisting = (paths: Set<string>, candidates: string[]) =>
  candidates.find((c) => paths.has(c)) ?? null;

/** Where a blog would go in this repository, or why Mellox can't add one. */
export function planBlogScaffold(paths: string[], packageJson: string | null): PlanResult {
  const tree = new Set(paths);
  const deps = dependencies(packageJson);
  if (tree.has(BLOG_MANIFEST_PATH))
    return { unsupported: "This site already has a blog from Mellox." };
  if (!tree.has("tsconfig.json") || !Object.keys(deps).length)
    return { unsupported: `${CANT} ${ASK}` };
  if (!Object.keys(deps).some((d) => d === "tailwindcss" || d.startsWith("@tailwindcss/")))
    return { unsupported: `${CANT} ${ASK}` };

  let plan: ScaffoldPlan | null = null;
  const tanstackRoot = firstExisting(tree, ["src/routes/__root.tsx", "app/routes/__root.tsx"]);
  const nextLayout = firstExisting(tree, ["src/app/layout.tsx", "app/layout.tsx"]);
  if ((deps["@tanstack/react-start"] || deps["@tanstack/start"]) && tanstackRoot) {
    const routesDir = tanstackRoot.replace(/\/__root\.tsx$/, "");
    const base = routesDir.replace(/\/routes$/, "");
    plan = {
      framework: "tanstack-start",
      routesDir,
      homeFile: firstExisting(tree, [`${routesDir}/index.tsx`]),
      layoutFile: tanstackRoot,
      contentDir: `${base}/content/blog`,
      libFile: `${base}/lib/mellox-blog.ts`,
      indexFile: `${routesDir}/blog/index.tsx`,
      postFile: `${routesDir}/blog/$slug.tsx`,
      nextMajor: null,
    };
  } else if (deps.next && nextLayout) {
    const routesDir = nextLayout.replace(/\/layout\.tsx$/, "");
    const prefix = routesDir.startsWith("src/") ? "src/" : "";
    const major = Number(/(\d+)/.exec(deps.next)?.[1] ?? NaN);
    plan = {
      framework: "next-app",
      routesDir,
      homeFile: firstExisting(tree, [`${routesDir}/page.tsx`]),
      layoutFile: nextLayout,
      contentDir: "content/blog",
      libFile: `${prefix}lib/mellox-blog.ts`,
      indexFile: `${routesDir}/blog/page.tsx`,
      postFile: `${routesDir}/blog/[slug]/page.tsx`,
      // An unreadable version ("latest", a tag) is treated as current.
      nextMajor: Number.isFinite(major) ? major : 15,
    };
  }
  if (!plan) return { unsupported: `${CANT} ${ASK}` };

  const taken = paths.some(
    (p) =>
      p === plan.libFile ||
      p.startsWith(`${plan.routesDir}/blog/`) ||
      /^(src\/)?(routes|app|pages)\/blog(\.[jt]sx?|\/)/.test(
        p.replace(/^app\/routes\//, "routes/"),
      ),
  );
  if (taken)
    return {
      unsupported: `Your site already has a /blog page that Mellox can't add posts to. ${ASK}`,
    };
  return { plan };
}

/* ───────────────────────── the site's own header and footer ───────────────────────── */

export type HomeImport = { name: string; file: string; isDefault: boolean };

const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx"];

function resolveImport(spec: string, fromFile: string, tree: Set<string>): string | null {
  const bases: string[] = [];
  if (spec.startsWith("@/") || spec.startsWith("~/"))
    bases.push(`src/${spec.slice(2)}`, spec.slice(2));
  else if (spec.startsWith(".")) {
    const parts = fromFile.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else if (seg !== ".") parts.push(seg);
    }
    bases.push(parts.join("/"));
  } else return null; // a package
  for (const base of bases)
    for (const ext of EXTENSIONS) if (tree.has(base + ext)) return base + ext;
  return null;
}

/** Components a file imports from the repository itself (packages are skipped). */
export function localImports(source: string, fromFile: string, paths: string[]): HomeImport[] {
  const tree = new Set(paths);
  const out: HomeImport[] = [];
  const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) {
    const file = resolveImport(m[3], fromFile, tree);
    if (!file || !/\.[jt]sx$/.test(file)) continue;
    if (m[1]) out.push({ name: m[1], file, isDefault: true });
    for (const part of (m[2] ?? "").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name && /^[A-Z][\w$]*$/.test(name) && !part.trim().startsWith("type "))
        out.push({ name, file, isDefault: false });
    }
  }
  return out;
}

export type ChromePart = HomeImport & { wrapClass: string };
export type Chrome = {
  header: ChromePart | null;
  footer: ChromePart | null;
  /** The root layout already renders the header and footer on every page. */
  inherited: boolean;
};

const HEADER_NAME = /(nav|header|topbar)/i;
const FOOTER_NAME = /footer/i;
/** A menu that links to sections of the home page ("#pricing") is dead on any other page. */
const SECTION_ANCHOR = /(href|to)\s*[=:]\s*\{?\s*["'`]#[A-Za-z]/;

function partFrom(imp: HomeImport, home: string): ChromePart | null {
  // Used bare (<Nav />): proof that it needs no props.
  if (!new RegExp(`<${imp.name}\\s*/>`).test(home)) return null;
  const wrap = new RegExp(`<div className="([^"]*)">\\s*<${imp.name}\\s*/>\\s*</div>`).exec(home);
  return { ...imp, wrapClass: cleanClass(wrap?.[1], "") };
}

/** The header and footer the home page uses, when a blog page can wear them too. */
export function pickChrome(args: {
  homeSource: string | null;
  layoutSource: string | null;
  imports: HomeImport[];
  /** Source of each imported component file, by path. */
  sources: Record<string, string>;
}): Chrome {
  if (args.layoutSource && /<\s*\w*(Nav|Header|Footer)\w*[\s/>]/.test(args.layoutSource))
    return { header: null, footer: null, inherited: true };
  const home = args.homeSource ?? "";
  let header: ChromePart | null = null;
  let footer: ChromePart | null = null;
  for (const imp of args.imports) {
    const source = args.sources[imp.file];
    if (!source) continue;
    if (!footer && FOOTER_NAME.test(imp.name)) footer = partFrom(imp, home);
    else if (!header && HEADER_NAME.test(imp.name) && !SECTION_ANCHOR.test(source))
      header = partFrom(imp, home);
  }
  return { header, footer, inherited: false };
}

/* ───────────────────────── design ───────────────────────── */

export type BlogDesign = {
  brandName: string;
  pageClass: string;
  mainClass: string;
  eyebrowClass: string;
  titleClass: string;
  ledeClass: string;
  cardClass: string;
  cardTitleClass: string;
  metaClass: string;
  linkClass: string;
  /** One class that colours links inside an article ("text-primary"). */
  accentClass: string;
  headerBarClass: string;
  brandClass: string;
  navLinkClass: string;
};

const CLASS_OK = /^[A-Za-z0-9 _\-:/[\]().%,#!&>*=+~@']*$/;
const TOKEN_OK = /^[A-Za-z0-9_\-:/[\]().%#]+$/;

/** A class string safe to place inside className="…", or the fallback. */
export function cleanClass(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.replace(/\s+/g, " ").trim();
  return v.length <= 300 && CLASS_OK.test(v) ? v : fallback;
}

/** Plain defaults: the site's own colour tokens when it has them, neutral greys otherwise. */
export function defaultDesign(args: {
  brandName: string;
  css: string | null;
  reusesHeader: boolean;
}): BlogDesign {
  const semantic = !!args.css && /--muted-foreground\s*:/.test(args.css);
  const c = semantic
    ? {
        page: "bg-background text-foreground",
        muted: "text-muted-foreground",
        border: "border-border",
        card: "bg-card",
        accent: "text-primary",
        strong: "hover:text-foreground",
      }
    : {
        page: "bg-white text-neutral-900",
        muted: "text-neutral-600",
        border: "border-neutral-200",
        card: "bg-white",
        accent: "text-blue-600",
        strong: "hover:text-neutral-900",
      };
  return {
    brandName: args.brandName,
    pageClass: `min-h-screen ${c.page}`,
    mainClass: args.reusesHeader ? "pt-32 pb-24" : "py-16 sm:py-20",
    eyebrowClass: `text-xs font-semibold uppercase tracking-[0.18em] ${c.muted}`,
    titleClass: "mt-3 text-4xl font-bold tracking-tight sm:text-5xl",
    ledeClass: `mt-4 text-lg leading-relaxed ${c.muted}`,
    cardClass: `block rounded-2xl border ${c.border} ${c.card} p-6 transition-shadow hover:shadow-lg`,
    cardTitleClass: "text-xl font-semibold tracking-tight",
    metaClass: `text-sm ${c.muted}`,
    linkClass: `text-sm font-medium ${c.accent} hover:underline`,
    accentClass: c.accent,
    headerBarClass: `border-b ${c.border}`,
    brandClass: "text-sm font-semibold tracking-tight",
    navLinkClass: `text-sm ${c.muted} transition-colors ${c.strong}`,
  };
}

/** Keep each proposed value only if it is safe; everything else stays the default. */
export function mergeDesign(base: BlogDesign, proposed: unknown): BlogDesign {
  if (!proposed || typeof proposed !== "object") return base;
  const p = proposed as Record<string, unknown>;
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof BlogDesign)[]) {
    if (key === "brandName") {
      const name = typeof p.brandName === "string" ? p.brandName.replace(/\s+/g, " ").trim() : "";
      if (name && name.length <= 60 && !/[<>{}`\\]/.test(name)) out.brandName = name;
    } else if (key === "accentClass") {
      const token = typeof p.accentClass === "string" ? p.accentClass.trim() : "";
      if (token && token.length <= 60 && TOKEN_OK.test(token)) out.accentClass = token;
    } else out[key] = cleanClass(p[key], base[key]) || base[key];
  }
  return out;
}

/* ───────────────────────── a "Blog" link in the site's menu ───────────────────────── */

const INSERT_FORBIDDEN =
  /import|require|script|dangerously|eval|https?:|javascript:|\bon[A-Z]\w*\s*=|`|\\|\$\{/;

function balanced(text: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const ch of text) {
    if ("([{".includes(ch)) stack.push(ch);
    else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
  }
  const count = (ch: string) => text.split(ch).length - 1;
  return !stack.length && count('"') % 2 === 0 && count("'") % 2 === 0 && count("<") === count(">");
}

/**
 * Add one link to the blog right after an exact snippet of a menu file. Only a
 * small, self-contained insertion is accepted; anything else returns null and
 * the file is left alone.
 */
export function insertNavLink(
  source: string,
  after: unknown,
  insert: unknown,
  routePrefix = BLOG_ROUTE_PREFIX,
): string | null {
  if (typeof after !== "string" || typeof insert !== "string") return null;
  if (after.length < 8 || !insert.trim() || insert.length > 300) return null;
  if (source.split(after).length !== 2) return null; // must match exactly once
  if (new RegExp(`["']${routePrefix}["'/]`).test(source)) return null; // already linked
  const links = insert.match(new RegExp(`["']${routePrefix}["']`, "g")) ?? [];
  if (links.length !== 1 || INSERT_FORBIDDEN.test(insert) || !balanced(insert)) return null;
  if ((insert.match(/\n/g) ?? []).length > 6) return null;
  const at = source.indexOf(after) + after.length;
  return source.slice(0, at) + insert + source.slice(at);
}

/* ───────────────────────── files ───────────────────────── */

export type ScaffoldFile = { path: string; content: string };

/** Import path from one repository file to another, without the extension. */
export function relativeImport(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.replace(/\.[jt]sx?$/, "").split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  return (up ? "../".repeat(up) : "./") + to.slice(i).join("/");
}

const str = (s: string) => JSON.stringify(s);
const cls = (...parts: string[]) => `"${parts.filter(Boolean).join(" ")}"`;

const PROSE = [
  "[&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_h3]:mt-8 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-6 [&_h4]:font-semibold",
  "[&_p]:mt-5 [&_p]:leading-7 [&_li]:leading-7",
  "[&_ul]:mt-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6",
  "[&_ol]:mt-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
  "[&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:mt-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-5 [&_blockquote]:italic",
  "[&_pre]:mt-6 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:p-4 [&_pre]:text-sm",
  "[&_table]:mt-6 [&_table]:w-full [&_table]:text-left [&_table]:text-sm",
  "[&_th]:border-b [&_th]:py-2 [&_th]:pr-4 [&_td]:border-b [&_td]:py-2 [&_td]:pr-4",
  "[&_img]:mt-6 [&_img]:rounded-xl [&_hr]:my-10",
].join(" ");

const POST_TYPE = `export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  dek: string;
  date: string;
  category: string | null;
  tags: string[];
  /** The article as HTML, written and cleaned by Mellox. */
  html: string;
  faq: { question: string; answer: string }[];
  jsonLd: Record<string, unknown>[];
};`;

const HELPERS = `const isPost = (p: BlogPost | undefined): p is BlogPost =>
  !!p && typeof p.slug === "string" && typeof p.title === "string" && typeof p.html === "string";

const newestFirst = (a: BlogPost, b: BlogPost) => (a.date < b.date ? 1 : -1);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });`;

function libFile(plan: ScaffoldPlan, viteTypes: boolean): string {
  const intro = `// Blog posts published from Mellox. Each post is one JSON file in ${plan.contentDir}.`;
  if (plan.framework === "next-app")
    return `${intro}
import fs from "node:fs";
import path from "node:path";

${POST_TYPE}

${HELPERS}

const DIR = path.join(process.cwd(), ${str(plan.contentDir)});

export function getPosts(): BlogPost[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as BlogPost;
      } catch {
        return undefined;
      }
    })
    .filter(isPost)
    .sort(newestFirst);
}

export const getPost = (slug: string) => getPosts().find((p) => p.slug === slug);
`;
  const glob = relativeImport(plan.libFile, `${plan.contentDir}/x`).replace(/x$/, "*.json");
  return `${intro}
${POST_TYPE}

${HELPERS}
${viteTypes ? "" : "\n// @ts-ignore -- Vite expands this at build time.\n"}
const files = import.meta.glob<BlogPost>(${str(glob)}, { eager: true, import: "default" });

const posts: BlogPost[] = Object.values(files).filter(isPost).sort(newestFirst);

export const getPosts = () => posts;

export const getPost = (slug: string) => posts.find((p) => p.slug === slug);
`;
}

function chromeImports(chrome: Chrome, fromFile: string): string[] {
  return [chrome.header, chrome.footer]
    .filter((p): p is ChromePart => !!p)
    .map((p) => {
      const spec = str(relativeImport(fromFile, p.file));
      return p.isDefault ? `import ${p.name} from ${spec};` : `import { ${p.name} } from ${spec};`;
    });
}

function chromeJsx(part: ChromePart | null, indent: string): string {
  if (!part) return "";
  return part.wrapClass
    ? `${indent}<div className=${cls(part.wrapClass)}>\n${indent}  <${part.name} />\n${indent}</div>\n`
    : `${indent}<${part.name} />\n`;
}

function headerJsx(chrome: Chrome, d: BlogDesign, indent: string): string {
  if (chrome.header) return chromeJsx(chrome.header, indent);
  if (chrome.inherited) return "";
  return `${indent}<header className=${cls(d.headerBarClass)}>
${indent}  <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
${indent}    <a href="/" className=${cls(d.brandClass)}>
${indent}      {${str(d.brandName)}}
${indent}    </a>
${indent}    <nav className="flex items-center gap-6">
${indent}      <a href="/" className=${cls(d.navLinkClass)}>
${indent}        Home
${indent}      </a>
${indent}      <a href=${str(BLOG_ROUTE_PREFIX)} className=${cls(d.navLinkClass)}>
${indent}        Blog
${indent}      </a>
${indent}    </nav>
${indent}  </div>
${indent}</header>
`;
}

function indexView(chrome: Chrome, d: BlogDesign): string {
  return `function BlogIndexView({ posts }: { posts: BlogPost[] }) {
  return (
    <div className=${cls(d.pageClass)}>
${headerJsx(chrome, d, "      ")}      <main className=${cls(d.mainClass)}>
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <p className=${cls(d.eyebrowClass)}>Blog</p>
          <h1 className=${cls(d.titleClass)}>{${str(`The ${d.brandName} blog`)}}</h1>
          {posts.length === 0 ? (
            <p className=${cls("mt-12", d.metaClass)}>No posts yet.</p>
          ) : (
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {posts.map((post) => (
                <a key={post.slug} href={${str(`${BLOG_ROUTE_PREFIX}/`)} + post.slug} className=${cls(d.cardClass)}>
                  <p className=${cls(d.metaClass)}>{formatDate(post.date)}</p>
                  <h2 className=${cls("mt-2", d.cardTitleClass)}>{post.title}</h2>
                  <p className=${cls("mt-3", d.metaClass)}>{post.description}</p>
                  <span className=${cls("mt-4 inline-block", d.linkClass)}>Read more</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>
${chromeJsx(chrome.footer, "      ")}    </div>
  );
}`;
}

function postView(chrome: Chrome, d: BlogDesign): string {
  return `function BlogPostView({ post }: { post: BlogPost }) {
  return (
    <div className=${cls(d.pageClass)}>
${headerJsx(chrome, d, "      ")}      <main className=${cls(d.mainClass)}>
        <article className="mx-auto max-w-3xl px-4 sm:px-6">
          <a href=${str(BLOG_ROUTE_PREFIX)} className=${cls(d.linkClass)}>
            All posts
          </a>
          <p className=${cls("mt-8", d.metaClass)}>
            {formatDate(post.date)}
            {post.category ? " · " + post.category : ""}
          </p>
          <h1 className=${cls(d.titleClass)}>{post.title}</h1>
          {post.dek ? <p className=${cls(d.ledeClass)}>{post.dek}</p> : null}
          <div
            className=${cls("mt-10", PROSE, `[&_a]:${d.accentClass}`)}
            dangerouslySetInnerHTML={{ __html: post.html }}
          />
        </article>
      </main>
${chromeJsx(chrome.footer, "      ")}      {(post.jsonLd ?? []).map((entry, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry).replace(/</g, "\\\\u003c") }}
        />
      ))}
    </div>
  );
}`;
}

export type BlogManifest = {
  version: 1;
  framework: BlogFramework;
  contentDir: string;
  format: "json";
  routePrefix: string;
};

/** The manifest Mellox left in a repository, or null when it isn't one. */
export function parseBlogManifest(text: string): BlogManifest | null {
  try {
    const m = JSON.parse(text) as Record<string, unknown>;
    const dir = typeof m.contentDir === "string" ? m.contentDir : "";
    const prefix = typeof m.routePrefix === "string" ? m.routePrefix : "";
    if (m.format !== "json") return null;
    if (m.framework !== "tanstack-start" && m.framework !== "next-app") return null;
    if (!/^[A-Za-z0-9_][\w./-]{0,120}$/.test(dir) || dir.includes("..") || dir.endsWith("/"))
      return null;
    if (!/^\/[a-z0-9][a-z0-9/-]{0,60}$/.test(prefix) || prefix.endsWith("/")) return null;
    return {
      version: 1,
      framework: m.framework,
      contentDir: dir,
      format: "json",
      routePrefix: prefix,
    };
  } catch {
    return null;
  }
}

/** Every new file of the blog, ready to commit. Existing files are not touched. */
export function buildBlogFiles(args: {
  plan: ScaffoldPlan;
  chrome: Chrome;
  design: BlogDesign;
  host: string;
  /** The project already declares Vite's client types (TanStack only). */
  viteTypes?: boolean;
}): ScaffoldFile[] {
  const { plan, chrome, design: d } = args;
  const site = `https://${args.host}`;
  const blogTitle = `Blog | ${d.brandName}`;
  const blogDescription = `Articles and guides from ${d.brandName}.`;
  const lib = (from: string) => str(relativeImport(from, plan.libFile));
  const manifest: BlogManifest = {
    version: 1,
    framework: plan.framework,
    contentDir: plan.contentDir,
    format: "json",
    routePrefix: BLOG_ROUTE_PREFIX,
  };
  const files: ScaffoldFile[] = [
    {
      path: BLOG_MANIFEST_PATH,
      content: `${JSON.stringify(
        {
          ...manifest,
          about: `Blog posts published from Mellox are added to ${plan.contentDir}, one JSON file per post.`,
        },
        null,
        2,
      )}\n`,
    },
    { path: plan.libFile, content: libFile(plan, args.viteTypes ?? true) },
  ];

  if (plan.framework === "tanstack-start") {
    files.push({
      path: plan.indexFile,
      content: `import { createFileRoute } from "@tanstack/react-router";
import { formatDate, getPosts, type BlogPost } from ${lib(plan.indexFile)};
${chromeImports(chrome, plan.indexFile).join("\n")}

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: ${str(blogTitle)} },
      { name: "description", content: ${str(blogDescription)} },
      { property: "og:title", content: ${str(blogTitle)} },
      { property: "og:description", content: ${str(blogDescription)} },
    ],
    links: [{ rel: "canonical", href: ${str(`${site}${BLOG_ROUTE_PREFIX}`)} }],
  }),
  component: BlogIndexPage,
});

function BlogIndexPage() {
  return <BlogIndexView posts={getPosts()} />;
}

${indexView(chrome, d)}
`,
    });
    files.push({
      path: plan.postFile,
      content: `import { createFileRoute, notFound } from "@tanstack/react-router";
import { formatDate, getPost, type BlogPost } from ${lib(plan.postFile)};
${chromeImports(chrome, plan.postFile).join("\n")}

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    if (!getPost(params.slug)) throw notFound();
  },
  head: ({ params }) => {
    const post = getPost(params.slug);
    if (!post) return {};
    return {
      meta: [
        { title: post.title + ${str(` | ${d.brandName}`)} },
        { name: "description", content: post.description },
        { property: "og:title", content: post.title },
        { property: "og:description", content: post.description },
        { property: "og:type", content: "article" },
        { name: "twitter:title", content: post.title },
        { name: "twitter:description", content: post.description },
      ],
      links: [{ rel: "canonical", href: ${str(`${site}${BLOG_ROUTE_PREFIX}/`)} + post.slug }],
    };
  },
  component: BlogPostPage,
});

function BlogPostPage() {
  const { slug } = Route.useParams();
  const post = getPost(slug);
  return post ? <BlogPostView post={post} /> : null;
}

${postView(chrome, d)}
`,
    });
  } else {
    const params = (plan.nextMajor ?? 15) >= 15 ? "Promise<{ slug: string }>" : "{ slug: string }";
    files.push({
      path: plan.indexFile,
      content: `import type { Metadata } from "next";
import { formatDate, getPosts, type BlogPost } from ${lib(plan.indexFile)};
${chromeImports(chrome, plan.indexFile).join("\n")}

export const metadata: Metadata = {
  title: ${str(blogTitle)},
  description: ${str(blogDescription)},
  alternates: { canonical: ${str(`${site}${BLOG_ROUTE_PREFIX}`)} },
  openGraph: { title: ${str(blogTitle)}, description: ${str(blogDescription)} },
};

export default function BlogIndexPage() {
  return <BlogIndexView posts={getPosts()} />;
}

${indexView(chrome, d)}
`,
    });
    files.push({
      path: plan.postFile,
      content: `import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDate, getPost, getPosts, type BlogPost } from ${lib(plan.postFile)};
${chromeImports(chrome, plan.postFile).join("\n")}

type Props = { params: ${params} };

export const dynamicParams = false;

export function generateStaticParams() {
  return getPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: post.title + ${str(` | ${d.brandName}`)},
    description: post.description,
    alternates: { canonical: ${str(`${site}${BLOG_ROUTE_PREFIX}/`)} + post.slug },
    openGraph: { title: post.title, description: post.description, type: "article" },
    twitter: { title: post.title, description: post.description },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  return <BlogPostView post={post} />;
}

${postView(chrome, d)}
`,
    });
  }
  return files.map((f) => ({ path: f.path, content: f.content.replace(/\n{3,}/g, "\n\n") }));
}
