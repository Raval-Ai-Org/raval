import "server-only";
// blog-setup.server.ts — add a blog to a website whose repository has none.
//
//   start     a person asks for it (editor). The repository must be proven to
//             build the host (resolveSite + assertSourceOwnsHost). The row moves
//             missing → creating with a compare-and-set, so two clicks open one
//             pull request.
//   build     read the home page, its header and footer, and the stylesheet;
//             ask a model which of the site's own class names suit a blog
//             (lib/articles/blog-scaffold.ts checks every value and falls back
//             to a plain default; the model writes no code); write the pages
//             from fixed templates.
//   deliver   one pull request on a new mellox/post-blog-setup- branch. The
//             branch name is stored before the commit, so an interrupted run
//             never opens a second one. Mellox never merges.
//   follow    merged → the blog is detected from mellox-blog.json and articles
//             can be published; closed → back to "missing".
//
// New files only, plus (optionally) one small "Blog" link in the site's menu.
// No dependency, configuration or build file is touched (paths.ts refuses them).

import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { llmJson } from "@/lib/ai-gateway.server";
import {
  buildBlogFiles,
  defaultDesign,
  insertNavLink,
  localImports,
  mergeDesign,
  pickChrome,
  planBlogScaffold,
  type BlogDesign,
  type ScaffoldFile,
} from "@/lib/articles/blog-scaffold";
import { recordAudit } from "@/server/audit.server";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { HttpError } from "@/server/http-error";
import { runWithScope } from "@/server/request-context";
import { resolveSite, type SiteBinding } from "@/server/sites/resolve.server";
import {
  blogReady,
  detectGithubBlogSettings,
  ensureBlogSettings,
  loadBlogSettings,
  saveBlogSettings,
  type BlogSettingsRow,
} from "./blog.server";

const db = supabaseAdmin as unknown as { from: (table: string) => any };

type GithubBinding = Extract<SiteBinding, { provider: "github" }>;
type SetupContext = { workspaceId: string; userId: string };

const ROUTE = "articles.blog-design";
const STUCK_AFTER_MS = 6 * 60_000;
const CHROME_NAME = /(nav|header|topbar|footer)/i;

const DESIGN_KEYS: (keyof BlogDesign)[] = [
  "brandName",
  "pageClass",
  "mainClass",
  "eyebrowClass",
  "titleClass",
  "ledeClass",
  "cardClass",
  "cardTitleClass",
  "metaClass",
  "linkClass",
  "accentClass",
  "headerBarClass",
  "brandClass",
  "navLinkClass",
];

const text = { type: "string" };
const DESIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["design", "navLink"],
  properties: {
    design: {
      type: "object",
      additionalProperties: false,
      required: DESIGN_KEYS,
      properties: Object.fromEntries(DESIGN_KEYS.map((k) => [k, text])),
    },
    navLink: {
      type: "object",
      additionalProperties: false,
      required: ["file", "after", "insert"],
      properties: { file: text, after: text, insert: text },
    },
  },
};

type Proposal = {
  design?: unknown;
  navLink?: { file?: unknown; after?: unknown; insert?: unknown };
};

const SYSTEM = `You help add a blog to an existing website so it looks like part of that site.
You are given parts of the site's source code. Describe the site's own visual style as Tailwind class strings for the new blog pages. You do not write code; fixed templates use your class strings.

Rules:
- Use only classes and custom utilities that already appear in the supplied files (their colour tokens, radii, shadows, fonts, gradients, glass or card utilities), plus ordinary Tailwind layout and type utilities.
- Each value is a plain class string: letters, numbers, spaces and Tailwind punctuation. No quotes, braces or code.
- Keep the default value when the site gives no better one. Readable text matters more than decoration.
- "accentClass" is exactly one text-colour class for links inside an article.
- "brandName" is the brand's name as the site itself writes it.
- "mainClass" sets the vertical padding of the page's main area. If the site's header is fixed to the top, leave room for it.
- "navLink": to add one "Blog" link to the site's menu, give the path of one supplied menu file, "after" (an exact snippet copied from that file, which appears in it once, right after which the link goes) and "insert" (the text to add, in the same form as the neighbouring links, pointing to "/blog"). Leave all three empty when unsure.`;

async function proposeDesign(args: {
  ctx: SetupContext;
  defaults: BlogDesign;
  files: { path: string; content: string; role: string }[];
  reusedHeader: string | null;
}): Promise<Proposal | null> {
  const sources = args.files
    .map(
      (f) =>
        `### ${f.role}: ${f.path}\n${wrapUntrusted("repository-file", f.content, { maxChars: 9_000, route: ROUTE })}`,
    )
    .join("\n\n");
  const user = `Default values (keep any that already suit the site):
${JSON.stringify(args.defaults, null, 2)}

${
  args.reusedHeader
    ? `The blog pages reuse the site's own header component (${args.reusedHeader}), so "headerBarClass", "brandClass" and "navLinkClass" are unused.`
    : "The blog pages get a simple header bar: the brand name on the left, Home and Blog links on the right."
}

${sources}

${UNTRUSTED_DATA_RULE}`;
  return runWithScope(
    { workspaceId: args.ctx.workspaceId, userId: args.ctx.userId, route: ROUTE },
    () =>
      llmJson<Proposal | null>({
        route: ROUTE,
        system: SYSTEM,
        user,
        outputSchema: DESIGN_SCHEMA,
        maxTokens: 4_000,
        timeoutMs: 90_000,
        retries: 1,
        fallback: null,
      }),
  );
}

async function repository(workspaceId: string, binding: GithubBinding, userId: string) {
  const fixes = await import("@/server/geo/fixes/service.server");
  const { source, connection } = await fixes.loadSourceWithConnection(
    {
      supabase: supabaseAdmin as never,
      userId,
      workspaceId,
      canPropose: true,
      canManage: true,
    },
    binding.sourceId,
  );
  fixes.assertSourceOwnsHost(source, binding.host);
  return {
    source,
    connection,
    installationId: connection.external_account_id,
    repo: source.full_name,
    baseBranch: source.branch ?? source.default_branch ?? "main",
  };
}

const CSS_CANDIDATES = [
  "src/styles.css",
  "src/app/globals.css",
  "app/globals.css",
  "src/index.css",
  "src/styles/globals.css",
  "styles/globals.css",
  "src/app.css",
  "src/global.css",
];

/** Read the site, decide the design and write the blog's files (no write to GitHub). */
export async function planGithubBlog(ctx: SetupContext, binding: GithubBinding) {
  const git = await import("@/server/connectors/github/git.server");
  const repo = await repository(ctx.workspaceId, binding, ctx.userId);
  const base = await git.getBranch(repo.installationId, repo.repo, repo.baseBranch);
  if (!base) throw new HttpError(409, `Branch ${repo.baseBranch} was not found in ${repo.repo}.`);
  const { paths, truncated } = await git.getTreePaths(repo.installationId, repo.repo, base.treeSha);
  if (truncated) throw new HttpError(409, "This repository is too large for Mellox to read.");
  const read = async (path: string | null) =>
    path && paths.includes(path)
      ? ((await git.readFile(repo.installationId, repo.repo, path, base.sha).catch(() => null))
          ?.content ?? null)
      : null;

  const planned = planBlogScaffold(paths, await read("package.json"));
  if ("unsupported" in planned) throw new HttpError(409, planned.unsupported);
  const plan = planned.plan;

  const cssPath =
    CSS_CANDIDATES.find((p) => paths.includes(p)) ??
    paths.find((p) => /^(src|app|styles)\/.*\.css$/.test(p)) ??
    null;
  const [home, layout, css, tsconfig] = await Promise.all([
    read(plan.homeFile),
    read(plan.layoutFile),
    read(cssPath),
    read("tsconfig.json"),
  ]);
  const imports = home && plan.homeFile ? localImports(home, plan.homeFile, paths) : [];
  const menuFiles = [
    ...new Set(imports.filter((i) => CHROME_NAME.test(i.name)).map((i) => i.file)),
  ];
  const sampleFiles = [
    ...new Set(imports.filter((i) => !CHROME_NAME.test(i.name)).map((i) => i.file)),
  ].slice(0, 2);
  const sources: Record<string, string> = {};
  for (const file of [...menuFiles.slice(0, 4), ...sampleFiles]) {
    const content = await read(file);
    if (content) sources[file] = content;
  }
  const chrome = pickChrome({ homeSource: home, layoutSource: layout, imports, sources });

  const { data: workspace } = await db
    .from("workspaces")
    .select("name")
    .eq("id", ctx.workspaceId)
    .single();
  const defaults = defaultDesign({
    brandName: (workspace?.name as string | undefined) ?? binding.host,
    css,
    reusesHeader: !!chrome.header,
  });
  const context = [
    home && plan.homeFile ? { path: plan.homeFile, content: home, role: "Home page" } : null,
    css && cssPath ? { path: cssPath, content: css, role: "Stylesheet" } : null,
    ...menuFiles
      .filter((f) => sources[f])
      .map((f) => ({ path: f, content: sources[f], role: "Menu or footer" })),
    ...sampleFiles
      .filter((f) => sources[f])
      .map((f) => ({ path: f, content: sources[f], role: "Page section" })),
  ].filter((f): f is { path: string; content: string; role: string } => !!f);

  // A model failure never blocks the blog: the plain defaults still match the site's tokens.
  const proposal = await proposeDesign({
    ctx,
    defaults,
    files: context,
    reusedHeader: chrome.header?.file ?? null,
  }).catch((error) => {
    console.warn(
      "[blog-setup] design not proposed",
      error instanceof Error ? error.message : error,
    );
    return null;
  });
  const design = mergeDesign(defaults, proposal?.design);
  const files: ScaffoldFile[] = buildBlogFiles({
    plan,
    chrome,
    design,
    host: binding.host,
    viteTypes:
      !!tsconfig?.includes("vite/client") || paths.some((p) => p.endsWith("vite-env.d.ts")),
  });

  let menuLink: string | null = null;
  const nav = proposal?.navLink;
  if (nav && typeof nav.file === "string" && menuFiles.includes(nav.file) && sources[nav.file]) {
    const next = insertNavLink(sources[nav.file], nav.after, nav.insert);
    if (next) {
      files.push({ path: nav.file, content: next });
      menuLink = nav.file;
    }
  }
  return { repo, base, plan, chrome, design, files, menuLink, designedByModel: !!proposal };
}

function pullRequestBody(args: {
  host: string;
  plan: { contentDir: string; framework: string };
  files: ScaffoldFile[];
  menuLink: string | null;
  reusesHeader: boolean;
  reusesFooter: boolean;
}) {
  const chrome = [args.reusesHeader ? "header" : null, args.reusesFooter ? "footer" : null]
    .filter(Boolean)
    .join(" and ");
  return `Adds a blog to ${args.host}, built from your site's own styles${chrome ? ` and its ${chrome}` : ""}.

**What's in it**
${args.files.map((f) => `- \`${f.path}\`${f.path === args.menuLink ? " (adds a Blog link to the menu)" : ""}`).join("\n")}

**How it works**
- \`/blog\` lists your posts and \`/blog/<post>\` shows one, with its title, description and structured data.
- Each post is one JSON file in \`${args.plan.contentDir}\`. Mellox adds them with a pull request when you publish an article.
- No package is added and no configuration file is changed.${args.menuLink ? "" : "\n- Your menu wasn't changed. Add a link to `/blog` where you'd like it."}

Merge this to add the blog. Mellox never merges for you.`;
}

async function build(
  ctx: SetupContext,
  host: string,
  binding: GithubBinding,
  row: BlogSettingsRow,
) {
  const git = await import("@/server/connectors/github/git.server");
  const { postBranchName } = await import("@/server/connectors/github/paths");
  const { withAccess } = await import("@/server/connectors/github/service.server");
  const planned = await planGithubBlog(ctx, binding);
  const { repo, base, files } = planned;
  const setup = { ...(row.setup ?? { framework: planned.plan.framework }) };

  // The branch name is stored before the commit: a rerun finds it instead of writing twice.
  const headBranch = setup.branch ?? postBranchName("blog-setup", randomBytes(4).toString("hex"));
  const exists = setup.branch
    ? !!(await git.getBranch(repo.installationId, repo.repo, headBranch))
    : false;
  if (!exists) {
    await saveBlogSettings(ctx.workspaceId, host, { setup: { ...setup, branch: headBranch } });
    await withAccess(repo.connection, ctx.userId, () =>
      git.commitToNewBranch({
        installationId: repo.installationId,
        repo: repo.repo,
        baseBranch: repo.baseBranch,
        baseSha: base.sha,
        headBranch,
        message: `Add a blog\n\nBlog pages for ${host}, set up from Mellox. Posts are added as JSON files in ${planned.plan.contentDir}.`,
        files,
        maxFiles: files.length,
      }),
    );
  }
  const pr = await withAccess(repo.connection, ctx.userId, () =>
    git.createPullRequest({
      installationId: repo.installationId,
      repo: repo.repo,
      headBranch,
      baseBranch: repo.baseBranch,
      title: "Add a blog",
      body: pullRequestBody({
        host,
        plan: planned.plan,
        files,
        menuLink: planned.menuLink,
        reusesHeader: !!planned.chrome.header,
        reusesFooter: !!planned.chrome.footer,
      }),
    }),
  );
  await saveBlogSettings(ctx.workspaceId, host, {
    status: "creating",
    status_detail: `Pull request #${pr.number} adds the blog. Merge it on GitHub, then publish your article.`,
    source_id: binding.sourceId,
    setup: { ...setup, branch: headBranch, prNumber: pr.number, prUrl: pr.url },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "site.blog.setup.pr_opened",
    entity: "site_blog_settings",
    payload: {
      host,
      repository: repo.repo,
      branch: headBranch,
      pullRequest: pr.number,
      framework: planned.plan.framework,
      files: files.map((f) => f.path),
      designedByModel: planned.designedByModel,
    },
  });
}

/** Add a blog to a GitHub-built site: returns at once; the pull request follows. */
export async function startGithubBlogSetup(
  ctx: SetupContext,
  host: string,
): Promise<BlogSettingsRow> {
  const binding = (await resolveSite(ctx.workspaceId, host, { live: true })).binding;
  if (!binding || binding.provider !== "github" || !binding.verified)
    throw new HttpError(409, `Connect the GitHub repository that builds ${host} first.`);
  const existing = await ensureBlogSettings(ctx.workspaceId, host, binding);
  if (blogReady(existing)) throw new HttpError(409, "Your site already has a blog.");
  if (existing.status === "creating") return existing;
  if (!existing.setup?.framework)
    throw new HttpError(409, existing.status_detail ?? "Mellox can't add a blog to this site.");

  const { data: claimed } = await db
    .from("site_blog_settings")
    .update({
      status: "creating",
      status_detail: "Building a blog that matches your site. This takes about a minute.",
      setup: {
        framework: existing.setup.framework,
        // A branch an interrupted run already wrote is finished, not written again.
        branch: existing.setup.branch,
        startedAt: new Date().toISOString(),
      },
      detected_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .in("status", ["missing", "failed"])
    .select("id")
    .maybeSingle();
  const row = await ensureBlogSettings(ctx.workspaceId, host, binding);
  if (!claimed) return row; // someone else started it a moment ago

  after(async () => {
    try {
      await build(ctx, host, binding, row);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't add the blog.";
      console.error("[blog-setup] failed", host, message);
      const current = await loadBlogSettings(ctx.workspaceId, host).catch(() => null);
      await saveBlogSettings(ctx.workspaceId, host, {
        status: "failed",
        status_detail: (error instanceof HttpError
          ? message
          : `Couldn't add the blog: ${message}`
        ).slice(0, 900),
        setup: {
          framework: existing.setup?.framework ?? null,
          branch: current?.setup?.branch,
        },
      }).catch(() => undefined);
    }
  });
  return row;
}

/** Follow the pull request that adds the blog. */
export async function refreshGithubBlogSetup(
  row: BlogSettingsRow,
  binding: GithubBinding,
): Promise<BlogSettingsRow> {
  const setup = row.setup ?? { framework: null };
  if (!setup.prNumber) {
    const started = Date.parse(setup.startedAt ?? row.detected_at ?? "") || 0;
    if (Date.now() - started < STUCK_AFTER_MS) return row;
    return saveBlogSettings(row.workspace_id, row.host, {
      status: "failed",
      status_detail: "Adding the blog took too long. Try again.",
      setup: { framework: setup.framework, branch: setup.branch },
    });
  }
  try {
    const git = await import("@/server/connectors/github/git.server");
    const { data: source } = await db
      .from("workspace_sources")
      .select("full_name, connection_id")
      .eq("id", binding.sourceId)
      .eq("workspace_id", row.workspace_id)
      .single();
    const { data: conn } = await db
      .from("workspace_connections")
      .select("external_account_id")
      .eq("id", source.connection_id)
      .single();
    const pr = await git.getPullRequest(
      String(conn.external_account_id),
      source.full_name,
      setup.prNumber,
    );
    if (pr?.state === "merged")
      return await detectGithubBlogSettings(row.workspace_id, row.host, binding);
    if (pr?.state === "closed")
      return await saveBlogSettings(row.workspace_id, row.host, {
        status: "missing",
        status_detail: "The pull request that adds the blog was closed. You can add it again.",
        setup: { framework: setup.framework },
      });
  } catch (error) {
    console.warn(
      "[blog-setup] pull request not read",
      error instanceof Error ? error.message : error,
    );
  }
  return row;
}
