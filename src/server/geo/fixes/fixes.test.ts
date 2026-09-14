import { describe, expect, it } from "vitest";
import { parseRobotsAllow } from "@/lib/geo/robots";
import { needsRendering } from "@/lib/geo/rendering";
import { analyzePage } from "@/lib/geo/analyze-page";
import { evaluateVerification } from "@/lib/geo/verify";
import { fingerprintFor } from "@/lib/geo/score";
import type { CrawledPage, SiteArtifacts } from "@/lib/geo/types";
import {
  checkRepoPath,
  isMelloxBranch,
  isValidBaseBranch,
  proposalBranchName,
} from "@/server/connectors/github/paths";
import { applyEdits } from "./generate.server";
import { fixKindForRule, planFixTarget } from "./targets";
import { buildLlmsTxt, buildRobotsTxt, buildSitemapXml } from "./text-artifacts";
import { validateProposal } from "./validate";

const site: SiteArtifacts = {
  origin: "https://example.com",
  host: "example.com",
  https: true,
  robots: { status: "missing", text: "", sitemaps: [] },
  llms: { found: false, bytes: 0, full: false },
  sitemap: { found: true, urls: 3, isIndex: false, sources: ["https://example.com/sitemap.xml"] },
};

function page(url: string, html: string, over: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url,
    finalUrl: url,
    depth: 0,
    state: "fetched",
    statusCode: 200,
    contentType: "text/html",
    fetchMs: 100,
    skipReason: null,
    xRobotsTag: null,
    analysis: analyzePage(html, url, { bytes: html.length, truncated: false }),
    ...over,
  };
}

describe("repository path guard", () => {
  it("accepts site source files", () => {
    expect(checkRepoPath("public/llms.txt").ok).toBe(true);
    expect(checkRepoPath("src/app/layout.tsx").ok).toBe(true);
  });
  it("rejects traversal, CI, config, lockfiles and env", () => {
    for (const p of [
      "../secrets.txt",
      "/etc/passwd",
      "a/../b.html",
      ".github/workflows/ci.yml",
      "package.json",
      "package-lock.json",
      ".env.local",
      "next.config.ts",
      "node_modules/x/index.js",
      "scripts\\run.js",
      "bin/tool.sh",
    ]) {
      expect(checkRepoPath(p).ok, p).toBe(false);
    }
  });
  it("only creates mellox/ branches and never uses them as a base", () => {
    const b = proposalBranchName("meta-desc", "a1b2c3");
    expect(b).toBe("mellox/geo-meta-desc-a1b2c3");
    expect(isMelloxBranch(b)).toBe(true);
    expect(isMelloxBranch("main")).toBe(false);
    expect(isValidBaseBranch("main")).toBe(true);
    expect(isValidBaseBranch("mellox/geo-x-aaaaaa")).toBe(false);
    expect(isValidBaseBranch("a/../b")).toBe(false);
  });
});

describe("fix targets", () => {
  it("maps supported rules and leaves content/trust rules manual", () => {
    expect(fixKindForRule("ai.bot.gptbot")).toBe("robots");
    expect(fixKindForRule("tech.meta_description")).toBe("meta-desc");
    expect(fixKindForRule("trust.about")).toBeNull();
    expect(fixKindForRule("tech.duplicate_title")).toBeNull();
  });
  it("plans a public/llms.txt for Next.js", () => {
    const plan = planFixTarget({
      ruleId: "ai.llms_txt",
      pageUrl: null,
      framework: "Next.js",
      paths: ["app/layout.tsx", "public/favicon.ico"],
    });
    expect(plan).toMatchObject({
      ok: true,
      strategy: "static_file",
      files: [{ path: "public/llms.txt", action: "create" }],
    });
  });
  it("uses the Next.js metadata route for robots when it exists", () => {
    const plan = planFixTarget({
      ruleId: "ai.robots_txt",
      pageUrl: null,
      framework: "Next.js",
      paths: ["app/layout.tsx", "app/robots.ts"],
    });
    expect(plan).toMatchObject({
      ok: true,
      strategy: "code_edit",
      files: [{ path: "app/robots.ts" }],
    });
  });
  it("finds App Router pages through route groups, skipping dynamic segments", () => {
    const paths = [
      "src/app/layout.tsx",
      "src/app/(marketing)/pricing/page.tsx",
      "src/app/blog/[slug]/page.tsx",
    ];
    expect(
      planFixTarget({
        ruleId: "tech.title",
        pageUrl: "https://example.com/pricing",
        framework: "Next.js",
        paths,
      }),
    ).toMatchObject({
      ok: true,
      files: [{ path: "src/app/(marketing)/pricing/page.tsx" }],
    });
    expect(
      planFixTarget({
        ruleId: "tech.title",
        pageUrl: "https://example.com/blog/hello",
        framework: "Next.js",
        paths,
      }).ok,
    ).toBe(false);
    expect(
      planFixTarget({
        ruleId: "tech.lang",
        pageUrl: "https://example.com/pricing",
        framework: "Next.js",
        paths,
      }),
    ).toMatchObject({
      ok: true,
      scope: "site",
      files: [{ path: "src/app/layout.tsx" }],
    });
  });
  it("refuses per-route tags for single-page apps except the homepage", () => {
    const paths = ["index.html", "src/main.tsx"];
    expect(
      planFixTarget({
        ruleId: "tech.title",
        pageUrl: "https://example.com/",
        framework: "Vite",
        paths,
      }).ok,
    ).toBe(true);
    expect(
      planFixTarget({
        ruleId: "tech.title",
        pageUrl: "https://example.com/about",
        framework: "Vite",
        paths,
      }).ok,
    ).toBe(false);
    expect(
      planFixTarget({
        ruleId: "perf.viewport",
        pageUrl: "https://example.com/x",
        framework: "Angular",
        paths: ["src/index.html"],
      }),
    ).toMatchObject({
      ok: true,
      files: [{ path: "src/index.html" }],
    });
  });
  it("maps static pages and rejects unknown frameworks", () => {
    const paths = ["site/index.html", "site/about.html"];
    expect(
      planFixTarget({
        ruleId: "tech.canonical",
        pageUrl: "https://example.com/about",
        framework: "Static HTML",
        paths,
      }),
    ).toMatchObject({
      ok: true,
      files: [{ path: "site/about.html" }],
    });
    expect(
      planFixTarget({ ruleId: "tech.title", pageUrl: null, framework: "Hugo", paths }).ok,
    ).toBe(false);
  });
});

describe("discovery file generators", () => {
  it("unblocks exactly one AI crawler", () => {
    const existing =
      "User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n";
    const r = buildRobotsTxt({ site, existing, bot: "GPTBot" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parseRobotsAllow(r.content, "GPTBot")).not.toBe("block");
    expect(parseRobotsAllow(r.content, "CCBot")).toBe("block");
  });
  it("adds an explicit allow group when a wildcard blocks everyone", () => {
    const r = buildRobotsTxt({ site, existing: "User-agent: *\nDisallow: /\n", bot: "ClaudeBot" });
    expect(r.ok && parseRobotsAllow(r.content, "ClaudeBot")).toBe("allow");
    expect(r.ok && parseRobotsAllow(r.content, "GPTBot")).toBe("block");
  });
  it("declares the sitemap only when one exists", () => {
    expect(
      buildRobotsTxt({ site, existing: "User-agent: *\nAllow: /\n", addSitemap: true }),
    ).toMatchObject({ ok: true });
    expect(
      buildRobotsTxt({
        site: { ...site, sitemap: { ...site.sitemap, found: false } },
        existing: "User-agent: *\n",
        addSitemap: true,
      }).ok,
    ).toBe(false);
  });
  it("builds llms.txt and sitemap.xml only from crawled pages", () => {
    const pages = [
      {
        url: "https://example.com/",
        title: "Example",
        description: "Home",
        pageType: "home" as const,
        noindex: false,
      },
      {
        url: "https://example.com/secret",
        title: "Hidden",
        description: null,
        pageType: "other" as const,
        noindex: true,
      },
    ];
    const llms = buildLlmsTxt({
      site,
      brandName: "Example Co",
      summary: "We make examples.",
      pages,
    });
    expect(llms.ok && llms.content).toContain("[Example](https://example.com/)");
    expect(llms.ok && llms.content).not.toContain("secret");
    const xml = buildSitemapXml({ site, pages });
    expect(xml.ok && xml.content).toContain("<loc>https://example.com/</loc>");
    expect(xml.ok && xml.content).not.toContain("secret");
  });
});

describe("model edits are applied exactly", () => {
  const current = [
    { path: "index.html", action: "update" as const, content: "<head><title>A</title></head>" },
  ];
  it("applies a unique match", () => {
    const r = applyEdits(current, [
      { path: "index.html", find: "<title>A</title>", replace: "<title>Better</title>", why: "x" },
    ]);
    expect(r.ok && r.files[0].after).toBe("<head><title>Better</title></head>");
  });
  it("rejects missing, ambiguous and out-of-plan edits", () => {
    expect(
      applyEdits(current, [{ path: "index.html", find: "<nope>", replace: "", why: "" }]).ok,
    ).toBe(false);
    expect(
      applyEdits(
        [{ ...current[0], content: "aa" }],
        [{ path: "index.html", find: "a", replace: "b", why: "" }],
      ).ok,
    ).toBe(false);
    expect(
      applyEdits(current, [{ path: "other.html", find: "<title>A</title>", replace: "", why: "" }])
        .ok,
    ).toBe(false);
  });
});

describe("proposal validation", () => {
  const html = (head: string) =>
    `<!doctype html><html lang="en"><head>${head}</head><body><main><h1>Example</h1><p>${"Real words about the product. ".repeat(20)}</p></main></body></html>`;

  it("passes a static HTML meta description fix and re-checks the rule", () => {
    const before = html("<title>Example home page for testing</title>");
    const after = html(
      '<title>Example home page for testing</title><meta name="description" content="Example makes practical example products for teams that want clear, dependable results every day.">',
    );
    const v = validateProposal({
      kind: "meta-desc",
      ruleId: "tech.meta_description",
      pageUrl: "https://example.com/",
      site,
      files: [{ path: "index.html", action: "update", before, after }],
      crawlerReadsFile: true,
    });
    expect(v.checks.find((c) => c.id === "rule")?.status).toBe("pass");
    expect(v.ok).toBe(true);
  });

  it("fails scripts, secrets, disallowed imports and syntax errors", () => {
    const v = validateProposal({
      kind: "title",
      ruleId: "tech.title",
      pageUrl: "https://example.com/",
      site,
      files: [
        {
          path: "app/page.tsx",
          action: "update",
          before: "export default function P() { return null }\n",
          after:
            'import x from "left-pad";\nconst k = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB";\nfetch("https://evil.example");\nexport default function P() { return (\n',
        },
      ],
      crawlerReadsFile: false,
    });
    const status = Object.fromEntries(v.checks.map((c) => [c.id, c.status]));
    expect(v.ok).toBe(false);
    expect(status.secrets).toBe("fail");
    expect(status.safety).toBe("fail");
    expect(status.syntax).toBe("fail");
    expect(status.rule).toBe("skipped");
  });

  it("rejects writes to forbidden paths", () => {
    const v = validateProposal({
      kind: "robots",
      ruleId: "ai.robots_txt",
      pageUrl: null,
      site,
      files: [{ path: ".github/workflows/x.yml", action: "create", before: null, after: "x" }],
      crawlerReadsFile: true,
    });
    expect(v.checks.find((c) => c.id === "paths")?.status).toBe("fail");
  });
});

describe("verification decision", () => {
  const url = "https://example.com/";
  const good = `<html lang="en"><head><title>Example home page for testing</title><meta name="description" content="Example makes practical example products for teams that want clear, dependable results every day."></head><body><h1>Hi</h1></body></html>`;
  const target = {
    fingerprint: fingerprintFor("tech.meta_description", "example.com", url),
    ruleId: "tech.meta_description",
    pageUrl: url,
  };

  it("verifies only an explicit pass on an analysed page", () => {
    const d = evaluateVerification({
      targets: [target],
      site,
      pages: [page(url, good)],
      baselineFingerprints: [],
    });
    expect(d.outcome).toBe("verified");
  });
  it("is not verified when the check still fails", () => {
    const d = evaluateVerification({
      targets: [target],
      site,
      pages: [page(url, "<html><head><title>x</title></head><body></body></html>")],
      baselineFingerprints: [],
    });
    expect(d.outcome).toBe("not_verified");
  });
  it("is inconclusive when the page couldn't be fetched (a missing finding is not a fix)", () => {
    const failed = {
      ...page(url, good),
      state: "failed" as const,
      analysis: null,
      skipReason: "timeout",
    };
    const d = evaluateVerification({
      targets: [target],
      site,
      pages: [failed],
      baselineFingerprints: [],
    });
    expect(d.outcome).toBe("inconclusive");
    expect(d.after[target.fingerprint].status).toBe("missing");
  });
});

describe("rendering decision", () => {
  it("renders an empty React/Vue/Angular shell but not a real short page", () => {
    const shell =
      '<html><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>';
    expect(needsRendering(shell, analyzePage(shell, "https://example.com/")).render).toBe(true);
    const ng = "<html><body><app-root></app-root></body></html>";
    expect(needsRendering(ng, analyzePage(ng, "https://example.com/")).render).toBe(true);
    const small = "<html><body><h1>Contact</h1><p>Email us at hello@example.com</p></body></html>";
    expect(needsRendering(small, analyzePage(small, "https://example.com/")).render).toBe(false);
    const ssr = `<html><body><div id="__next"><p>${"Server rendered words here. ".repeat(40)}</p></div></body></html>`;
    expect(needsRendering(ssr, analyzePage(ssr, "https://example.com/")).render).toBe(false);
  });
});
