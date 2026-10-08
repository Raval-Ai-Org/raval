import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  BLOG_MANIFEST_PATH,
  buildBlogFiles,
  cleanClass,
  defaultDesign,
  insertNavLink,
  localImports,
  mergeDesign,
  parseBlogManifest,
  pickChrome,
  planBlogScaffold,
  relativeImport,
  type Chrome,
  type ScaffoldPlan,
} from "./blog-scaffold";
import { githubDataPostFile } from "./blog";
import type { PublishableArticle } from "./render";

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

const TANSTACK_TREE = [
  "package.json",
  "tsconfig.json",
  "src/routes/__root.tsx",
  "src/routes/index.tsx",
  "src/styles.css",
  "src/components/landing/Nav.tsx",
  "src/components/landing/Footer.tsx",
  "src/components/landing/Hero.tsx",
];
const TANSTACK_PKG = pkg({ "@tanstack/react-start": "1.168.60", tailwindcss: "^4.2.1" });

const NEXT_TREE = ["package.json", "tsconfig.json", "src/app/layout.tsx", "src/app/page.tsx"];

const planOf = (paths: string[], packageJson: string): ScaffoldPlan => {
  const r = planBlogScaffold(paths, packageJson);
  if (!("plan" in r)) throw new Error(r.unsupported);
  return r.plan;
};

/** Syntax errors in a generated file (a template that doesn't parse breaks someone's build). */
function syntaxErrors(path: string, content: string): string[] {
  const out = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
  });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("planBlogScaffold", () => {
  it("plans a TanStack Start blog beside the routes", () => {
    expect(planOf(TANSTACK_TREE, TANSTACK_PKG)).toMatchObject({
      framework: "tanstack-start",
      homeFile: "src/routes/index.tsx",
      contentDir: "src/content/blog",
      libFile: "src/lib/mellox-blog.ts",
      indexFile: "src/routes/blog/index.tsx",
      postFile: "src/routes/blog/$slug.tsx",
    });
  });

  it("plans a Next.js App Router blog and reads the major version", () => {
    const plan = planOf(NEXT_TREE, pkg({ next: "^14.2.3", tailwindcss: "^3.4.0" }));
    expect(plan).toMatchObject({
      framework: "next-app",
      contentDir: "content/blog",
      libFile: "src/lib/mellox-blog.ts",
      indexFile: "src/app/blog/page.tsx",
      postFile: "src/app/blog/[slug]/page.tsx",
      nextMajor: 14,
    });
  });

  it("refuses what it can't build safely", () => {
    const refused = (paths: string[], p: string | null) =>
      "unsupported" in planBlogScaffold(paths, p);
    expect(refused(TANSTACK_TREE, null)).toBe(true);
    expect(refused(TANSTACK_TREE, pkg({ "@tanstack/react-start": "1" }))).toBe(true); // no Tailwind
    expect(
      refused(["package.json", "tsconfig.json", "index.html"], pkg({ tailwindcss: "4" })),
    ).toBe(true);
    expect(refused([...TANSTACK_TREE, "src/routes/blog/index.tsx"], TANSTACK_PKG)).toBe(true);
    expect(refused([...TANSTACK_TREE, "src/routes/blog.tsx"], TANSTACK_PKG)).toBe(true);
    expect(refused([...TANSTACK_TREE, BLOG_MANIFEST_PATH], TANSTACK_PKG)).toBe(true);
    expect(
      refused(
        TANSTACK_TREE.filter((p) => p !== "tsconfig.json"),
        TANSTACK_PKG,
      ),
    ).toBe(true);
  });
});

const HOME = `import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { Footer } from "@/components/landing/Footer";
function Page() {
  return (
    <div>
      <Nav />
      <Hero />
      <div className="dark bg-background text-foreground">
        <Footer />
      </div>
    </div>
  );
}`;

describe("the site's header and footer", () => {
  const imports = localImports(HOME, "src/routes/index.tsx", TANSTACK_TREE);

  it("finds the home page's own components and skips packages", () => {
    expect(imports.map((i) => i.name)).toEqual(["Nav", "Hero", "Footer"]);
    expect(imports[0]).toMatchObject({ file: "src/components/landing/Nav.tsx", isDefault: false });
  });

  it("reuses the footer with its wrapper, and a header only when its links work elsewhere", () => {
    const sources = {
      "src/components/landing/Nav.tsx": `const links = [{ label: "Pricing", href: "#pricing" }];`,
      "src/components/landing/Footer.tsx": `<a href="#">Docs</a>`,
    };
    const chrome = pickChrome({ homeSource: HOME, layoutSource: "<Outlet />", imports, sources });
    expect(chrome.header).toBeNull(); // section anchors are dead on /blog
    expect(chrome.footer).toMatchObject({
      name: "Footer",
      wrapClass: "dark bg-background text-foreground",
    });
    const plain = pickChrome({
      homeSource: HOME,
      layoutSource: null,
      imports,
      sources: { ...sources, "src/components/landing/Nav.tsx": `<a href="/pricing">Pricing</a>` },
    });
    expect(plain.header?.name).toBe("Nav");
  });

  it("leaves both to the layout when it already renders them", () => {
    const chrome = pickChrome({
      homeSource: HOME,
      layoutSource: "<body><Header />{children}<Footer /></body>",
      imports,
      sources: {},
    });
    expect(chrome).toEqual({ header: null, footer: null, inherited: true });
  });

  it("doesn't reuse a component the home page gives props to", () => {
    const home = HOME.replace("<Nav />", '<Nav variant="dark" />');
    const chrome = pickChrome({
      homeSource: home,
      layoutSource: null,
      imports,
      sources: { "src/components/landing/Nav.tsx": "<nav />" },
    });
    expect(chrome.header).toBeNull();
  });
});

describe("design values", () => {
  const base = defaultDesign({
    brandName: "Acme",
    css: "--muted-foreground: #000;",
    reusesHeader: false,
  });

  it("uses the site's tokens when it has them", () => {
    expect(base.metaClass).toContain("text-muted-foreground");
    expect(defaultDesign({ brandName: "Acme", css: null, reusesHeader: true })).toMatchObject({
      metaClass: "text-sm text-neutral-600",
      mainClass: "pt-32 pb-24",
    });
  });

  it("keeps a safe proposal and drops anything that could break the page", () => {
    const d = mergeDesign(base, {
      brandName: "Acme Labs",
      titleClass: "text-5xl font-bold text-gradient",
      cardClass: 'glass" onClick={alert(1)}',
      ledeClass: "text-lg {evil}",
      accentClass: "text-cyan hover:underline",
      linkClass: 42,
    });
    expect(d.brandName).toBe("Acme Labs");
    expect(d.titleClass).toBe("text-5xl font-bold text-gradient");
    expect(d.cardClass).toBe(base.cardClass);
    expect(d.ledeClass).toBe(base.ledeClass);
    expect(d.accentClass).toBe(base.accentClass); // one class only
    expect(d.linkClass).toBe(base.linkClass);
    expect(mergeDesign(base, { brandName: "<script>" }).brandName).toBe("Acme");
    expect(mergeDesign(base, null)).toEqual(base);
  });

  it("refuses characters that end a className", () => {
    expect(cleanClass("a`b", "x")).toBe("x");
    expect(cleanClass("a\\b", "x")).toBe("x");
    expect(cleanClass("  mt-4   [&_p]:leading-7 ", "x")).toBe("mt-4 [&_p]:leading-7");
  });
});

describe("insertNavLink", () => {
  const nav = `const links = [
  { label: "Pricing", href: "#pricing", id: "pricing" },
  { label: "FAQ", href: "#faq", id: "faq" },
];`;
  const after = `{ label: "Pricing", href: "#pricing", id: "pricing" },`;

  it("adds one link after an exact snippet", () => {
    const out = insertNavLink(nav, after, `\n  { label: "Blog", href: "/blog", id: "blog" },`);
    expect(out).toContain(
      `id: "pricing" },\n  { label: "Blog", href: "/blog", id: "blog" },\n  { label: "FAQ"`,
    );
  });

  it("refuses anything that isn't a small, self-contained link", () => {
    const bad = (a: unknown, insert: unknown, source = nav) =>
      expect(insertNavLink(source, a, insert)).toBeNull();
    bad("label", `{ label: "Blog", href: "/blog" },`); // matches more than once
    bad("not in the file", `{ label: "Blog", href: "/blog" },`);
    bad(after, `{ label: "Blog", href: "/news" },`); // not the blog
    bad(after, `{ label: "Blog", href: "/blog" `); // unbalanced
    bad(after, `{ label: "Blog", href: "/blog", onClick: eval("x") },`);
    bad(after, `<a href="/blog" onClick={() => {}}>Blog</a>`);
    bad(after, `{ label: "Blog", href: "/blog" }, { label: "B", href: "/blog" },`); // two links
    bad(after, `{ label: "Blog", href: "/blog" },`, `${nav}\n<a href="/blog">Blog</a>`); // already linked
    bad(after, 7);
  });
});

describe("generated files", () => {
  const footer = { name: "Footer", file: "src/components/landing/Footer.tsx", isDefault: false };
  const chrome: Chrome = {
    header: null,
    footer: { ...footer, wrapClass: "dark bg-background" },
    inherited: false,
  };
  const design = defaultDesign({ brandName: `Three "Reach" AI`, css: null, reusesHeader: false });

  it("computes relative imports", () => {
    expect(relativeImport("src/routes/blog/$slug.tsx", "src/lib/mellox-blog.ts")).toBe(
      "../../lib/mellox-blog",
    );
    expect(relativeImport("app/blog/[slug]/page.tsx", "lib/mellox-blog.ts")).toBe(
      "../../../lib/mellox-blog",
    );
    expect(relativeImport("src/lib/a.ts", "src/lib/b.ts")).toBe("./b");
  });

  it("writes a TanStack Start blog that parses and wears the site's footer", () => {
    const plan = planOf(TANSTACK_TREE, TANSTACK_PKG);
    const files = buildBlogFiles({ plan, chrome, design, host: "example.com" });
    expect(files.map((f) => f.path)).toEqual([
      BLOG_MANIFEST_PATH,
      "src/lib/mellox-blog.ts",
      "src/routes/blog/index.tsx",
      "src/routes/blog/$slug.tsx",
    ]);
    for (const f of files.filter((x) => /\.tsx?$/.test(x.path)))
      expect(syntaxErrors(f.path, f.content), f.path).toEqual([]);
    const post = files[3].content;
    expect(post).toContain(`import { Footer } from "../../components/landing/Footer";`);
    expect(post).toContain(`<div className="dark bg-background">`);
    expect(post).toContain(`createFileRoute("/blog/$slug")`);
    expect(post).toContain(`"https://example.com/blog/" + post.slug`);
    expect(post).toContain(String.raw`replace(/</g, "\\u003c")`);
    expect(files[1].content).toContain(`import.meta.glob<BlogPost>("../content/blog/*.json"`);
    // A brand name with quotes stays a string, never markup.
    expect(files[2].content).toContain(JSON.stringify(`The Three "Reach" AI blog`));
    expect(files[2].content).toContain(`<a href="/blog" className=`); // its own header bar
    expect(parseBlogManifest(files[0].content)).toMatchObject({
      framework: "tanstack-start",
      contentDir: "src/content/blog",
      routePrefix: "/blog",
    });
  });

  it("writes a Next.js blog with the params shape its version expects", () => {
    const inherited: Chrome = { header: null, footer: null, inherited: true };
    for (const [version, params] of [
      ["^14.2.3", "{ slug: string }"],
      ["16.0.1", "Promise<{ slug: string }>"],
    ]) {
      const plan = planOf(NEXT_TREE, pkg({ next: version, tailwindcss: "^3" }));
      const files = buildBlogFiles({ plan, chrome: inherited, design, host: "example.com" });
      for (const f of files.filter((x) => /\.tsx?$/.test(x.path)))
        expect(syntaxErrors(f.path, f.content), f.path).toEqual([]);
      const post = files.find((f) => f.path === "src/app/blog/[slug]/page.tsx")!.content;
      expect(post).toContain(`type Props = { params: ${params} };`);
      expect(post).not.toContain("<header"); // the layout brings its own
      expect(files[1].content).toContain(`path.join(process.cwd(), "content/blog")`);
    }
  });

  it("rejects a manifest that points outside the repository", () => {
    const m = { framework: "next-app", format: "json", routePrefix: "/blog" };
    expect(parseBlogManifest(JSON.stringify({ ...m, contentDir: "../secrets" }))).toBeNull();
    expect(parseBlogManifest(JSON.stringify({ ...m, contentDir: "content/blog" }))).not.toBeNull();
    expect(
      parseBlogManifest(JSON.stringify({ ...m, contentDir: "content/blog", routePrefix: "//x" })),
    ).toBeNull();
    expect(parseBlogManifest("not json")).toBeNull();
  });
});

describe("a post for the blog Mellox added", () => {
  const article: PublishableArticle = {
    title: "Choosing a CRM",
    dek: "A short guide.",
    metaDescription: "What matters when a small team picks a CRM.",
    takeaways: ["Start from your process."],
    markdown: "# Dropped H1\n\nIntro <script>alert(1)</script> text.\n\n## Section\n\nText.",
    faq: [{ question: "Is it expensive?", answer: "Most have a free tier." }],
    slug: "choosing-a-crm",
    category: "Sales",
    tags: ["crm"],
  };

  it("is one JSON file with clean HTML and its own structured data", () => {
    const file = githubDataPostFile(article, {
      contentDir: "src/content/blog",
      url: "https://example.com/blog/choosing-a-crm",
      origin: "https://example.com",
      blogUrl: "https://example.com/blog",
      brandName: "Acme",
      date: "2026-10-08T10:00:00.000Z",
    });
    expect(file.path).toBe("src/content/blog/choosing-a-crm.json");
    const post = JSON.parse(file.content);
    expect(post).toMatchObject({
      slug: "choosing-a-crm",
      title: "Choosing a CRM",
      category: "Sales",
    });
    expect(post.html).toContain("<h2>Section</h2>");
    expect(post.html).not.toContain("<script");
    expect(post.html).not.toContain("<h1");
    expect(post.jsonLd.map((j: { "@type": string }) => j["@type"])).toEqual([
      "BlogPosting",
      "FAQPage",
      "BreadcrumbList",
    ]);
  });
});
