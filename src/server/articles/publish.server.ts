import "server-only";
// publish.server.ts — put a Studio article on the workspace's own website and
// prove it's there.
//
//   preview   which site builds the workspace's domain (resolveSite), where its
//             blog is (blog.server.ts), the exact article that would go out and
//             the AI Visibility gate on it (lib/articles/render.ts)
//   approve   one site_publications row per (article, host), bound to a hash of
//             exactly what was approved. Nothing is sent before this.
//   worker    leased (claim_site_publications), advanced by the geo-agents cron
//             hook and after() on approve:
//               approved → publishing → published → verifying → verified
//               GitHub: publishing → pr_open → (merged) → published → …
//             WordPress: a post (+ SEO description and, with the Mellox GEO
//             plugin, the article's JSON-LD). Webflow: a live CMS item.
//             GitHub: a post file on a new mellox/post- branch + pull request.
//   verify    fetch the live URL (safeFetch) and check title, body, indexability
//             and structured data (lib/articles/verify.ts). Only this marks a
//             publication verified.
//
// Provider writes are never blindly retried: an interrupted WordPress/Webflow
// create is found again by slug; a GitHub branch name is stored before commit.

import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { githubPostFile, webflowItemUrl } from "@/lib/articles/blog";
import type { PublicationStatus, PublicationView, PublishPreview } from "@/lib/articles/contracts";
import { PUBLICATION_ACTIVE } from "@/lib/articles/contracts";
import {
  articleBodyHtml,
  articleJsonLd,
  geoGate,
  slugify,
  type PublishableArticle,
} from "@/lib/articles/render";
import { verifyArticleHtml } from "@/lib/articles/verify";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { safeFetch } from "@/server/safe-fetch";
import type { FixContext } from "@/server/geo/fixes/service.server";
import { bindingView, resolveSite, type SiteBinding } from "@/server/sites/resolve.server";
import {
  blogReady,
  blogView,
  ensureBlogSettings,
  loadBlogSettings,
  type BlogSettingsRow,
} from "./blog.server";

const db = supabaseAdmin as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args: unknown) => any;
};

const WORKER = `publish-${process.pid}-${randomBytes(3).toString("hex")}`;
const PUBLICATION_COLS =
  "id, workspace_id, content_item_id, host, provider, slug, title, status, status_detail, scheduled_for, external_id, url, head_branch, pr_number, pr_url, payload_hash, verification, attempts, max_attempts, next_attempt_at, last_error, approved_by, published_at, verified_at, created_at";

type PublicationRow = {
  id: string;
  workspace_id: string;
  content_item_id: string;
  host: string;
  provider: "github" | "wordpress" | "webflow";
  slug: string;
  title: string;
  status: PublicationStatus;
  status_detail: string | null;
  scheduled_for: string | null;
  external_id: string | null;
  url: string | null;
  head_branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  payload_hash: string | null;
  verification: { checks?: { label: string; ok: boolean; detail: string }[] } | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  approved_by: string | null;
  published_at: string | null;
  verified_at: string | null;
  created_at: string;
};

export type PublishContext = Pick<
  FixContext,
  "supabase" | "userId" | "workspaceId" | "canPropose" | "canManage"
>;

/* ───────────────────────── article ───────────────────────── */

type ItemRow = {
  id: string;
  workspace_id: string;
  title: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  channel: string | null;
  status: string;
};

function toArticle(row: ItemRow, slugOverride?: string): PublishableArticle {
  const meta = (row.meta?.article ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const faq = Array.isArray(meta.faq)
    ? (meta.faq as { question?: unknown; answer?: unknown }[])
        .map((f) => ({ question: str(f.question), answer: str(f.answer) }))
        .filter((f) => f.question && f.answer)
        .slice(0, 6)
    : [];
  const title = str(row.title) || "Untitled";
  return {
    title,
    dek: str(meta.dek),
    metaDescription: str(meta.metaDescription),
    takeaways: list(meta.takeaways).slice(0, 6),
    markdown: row.body ?? "",
    faq,
    slug: slugify(slugOverride || str(meta.slug) || title),
    category: str(meta.category) || null,
    tags: list(meta.tags).slice(0, 8),
  };
}

const articleHash = (a: PublishableArticle) =>
  createHash("sha256").update(JSON.stringify(a)).digest("hex");

async function loadItem(workspaceId: string, contentItemId: string, client = db): Promise<ItemRow> {
  const { data } = await client
    .from("content_items")
    .select("id, workspace_id, title, body, meta, channel, status")
    .eq("id", contentItemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Article not found.");
  const row = data as ItemRow;
  if (row.channel !== "blog" || !(row.meta && "article" in row.meta))
    throw new HttpError(400, "Only articles can be published to a website.");
  return row;
}

async function workspaceFacts(workspaceId: string) {
  const { data } = await db
    .from("workspaces")
    .select("name, domain")
    .eq("id", workspaceId)
    .single();
  const host =
    typeof data?.domain === "string" && data.domain
      ? data.domain.toLowerCase().replace(/^www\./, "")
      : null;
  return { brand: (data?.name as string | undefined) ?? host ?? "Website", host };
}

const normHost = (h: string) =>
  h
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");

/**
 * Websites this workspace can publish to: its own domain plus every site its
 * connections serve (a WordPress blog may live on another host). Each is still
 * proven by resolveSite before anything is sent.
 */
export async function publishTargets(
  workspaceId: string,
  domain: string | null,
): Promise<string[]> {
  const [wp, wf, gh] = await Promise.all([
    db
      .from("wordpress_sites")
      .select("site_url")
      .eq("workspace_id", workspaceId)
      .eq("selected", true)
      .eq("status", "active"),
    db
      .from("webflow_sites")
      .select("domains, domain")
      .eq("workspace_id", workspaceId)
      .eq("selected", true)
      .eq("status", "active"),
    db
      .from("workspace_sources")
      .select("site_host")
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
  ]);
  const hosts = new Set<string>();
  if (domain) hosts.add(normHost(domain));
  for (const r of (wp.data ?? []) as { site_url: string }[]) {
    try {
      hosts.add(normHost(new URL(r.site_url).hostname));
    } catch {
      /* skip malformed */
    }
  }
  for (const r of (wf.data ?? []) as { domains: string[] | null; domain: string | null }[])
    for (const d of [...(r.domains ?? []), r.domain].filter((x): x is string => !!x))
      hosts.add(normHost(d));
  for (const r of (gh.data ?? []) as { site_host: string | null }[])
    if (r.site_host) hosts.add(normHost(r.site_host));
  return [...hosts];
}

/* ───────────────────────── views ───────────────────────── */

function publicationView(p: PublicationRow): PublicationView {
  return {
    id: p.id,
    host: p.host,
    provider: p.provider,
    slug: p.slug,
    title: p.title,
    status: p.status,
    statusDetail: p.status_detail,
    url: p.url,
    pr: p.pr_number && p.pr_url ? { number: p.pr_number, url: p.pr_url } : null,
    scheduledFor: p.scheduled_for,
    publishedAt: p.published_at,
    verifiedAt: p.verified_at,
    checks: p.verification?.checks ?? [],
    lastError: p.last_error,
    createdAt: p.created_at,
  };
}

function predictedUrl(blog: BlogSettingsRow | null, host: string, slug: string): string | null {
  if (!blog) return null;
  if (blog.provider === "webflow" && blog.webflow_field_map)
    return webflowItemUrl(`https://${host}`, blog.webflow_field_map.collectionSlug, slug);
  if (blog.provider === "github" && blog.route_prefix)
    return `https://${host}${blog.route_prefix}/${slug}`;
  return null; // WordPress decides from its permalink settings.
}

/** WordPress with the Mellox GEO plugin: Mellox writes the article's JSON-LD itself. */
const writesStructuredData = (b: SiteBinding | null) =>
  b?.provider === "wordpress" && b.seo === "mellox";

async function currentPublication(ctx: PublishContext, contentItemId: string, host: string) {
  const { data } = await (ctx.supabase as unknown as typeof db)
    .from("site_publications")
    .select(PUBLICATION_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("content_item_id", contentItemId)
    .eq("host", host)
    .maybeSingle();
  return (data as unknown as PublicationRow | null) ?? null;
}

async function chooseHost(workspaceId: string, requested: string | undefined) {
  const { brand, host: domain } = await workspaceFacts(workspaceId);
  const targets = await publishTargets(workspaceId, domain);
  if (requested) {
    const want = normHost(requested);
    if (!targets.includes(want))
      throw new HttpError(400, `${requested} isn't one of this workspace's websites.`);
    return { brand, host: want, targets };
  }
  // The workspace's own domain when a connection proves it; otherwise the first connected site that does.
  const order = domain
    ? [normHost(domain), ...targets.filter((t) => t !== normHost(domain))]
    : targets;
  for (const h of order) {
    const r = await resolveSite(workspaceId, h);
    if (r.binding?.verified) return { brand, host: h, targets };
  }
  return { brand, host: order[0] ?? null, targets };
}

export async function previewPublication(
  ctx: PublishContext,
  args: { contentItemId: string; slug?: string; recheckBlog?: boolean; host?: string },
): Promise<PublishPreview> {
  const item = await loadItem(
    ctx.workspaceId,
    args.contentItemId,
    ctx.supabase as unknown as typeof db,
  );
  const article = toArticle(item, args.slug);
  const { brand, host, targets } = await chooseHost(ctx.workspaceId, args.host);
  const empty = {
    title: article.title,
    slug: article.slug,
    url: null,
    metaDescription: article.metaDescription,
    words: article.markdown.split(/\s+/).filter(Boolean).length,
    faq: article.faq.length,
  };
  const provisional = `https://${host ?? "example.com"}/${article.slug}`;
  const gateJsonLd = articleJsonLd({
    article,
    url: provisional,
    origin: `https://${host ?? "example.com"}`,
    blogUrl: null,
    brandName: brand,
    authorName: null,
    datePublished: new Date().toISOString(),
  });
  const gate = geoGate(article, provisional, gateJsonLd);
  if (!host) {
    return {
      host: null,
      targets,
      site: null,
      blog: null,
      article: empty,
      gate,
      structuredData: "site",
      canPublish: false,
      reason: "Add your website to this workspace first.",
      publication: null,
    };
  }
  const resolution = await resolveSite(ctx.workspaceId, host, { live: true });
  const binding = resolution.binding;
  const site = binding ? bindingView(binding, resolution.placeholder) : null;
  const existing = await currentPublication(ctx, args.contentItemId, host);
  if (!binding || !binding.verified) {
    return {
      host,
      targets,
      site,
      blog: null,
      article: empty,
      gate,
      structuredData: "site",
      canPublish: false,
      reason:
        resolution.problems[0] ??
        `Connect the WordPress, Webflow or GitHub account that builds ${host} first (Settings → Connections).`,
      publication: existing ? publicationView(existing) : null,
    };
  }
  const blog = await ensureBlogSettings(ctx.workspaceId, host, binding, {
    force: args.recheckBlog,
  });
  const url = existing?.url ?? predictedUrl(blog, host, article.slug);
  let reason: string | null = null;
  if (!ctx.canPropose) reason = "An editor can publish articles.";
  else if (!["approved", "scheduled", "published"].includes(item.status))
    reason = "Approve the article first.";
  else if (!blogReady(blog)) reason = blog.status_detail ?? "Set up a blog on your site first.";
  else if (!gate.ok) reason = "Fix the checks below before publishing.";
  else if (resolution.placeholder)
    reason = `${host} shows visitors a “coming soon” page. Launch the site first so the article can be seen.`;
  else if (binding.provider === "webflow" && binding.missingWriteScopes.length)
    reason = "Reconnect Webflow and allow Mellox to edit your site.";
  else if (existing && PUBLICATION_ACTIVE.includes(existing.status))
    reason = "This article is already being published.";
  else if (existing?.status === "verified") reason = "This article is already live on your site.";
  return {
    host,
    targets,
    site,
    blog: blogView(blog),
    article: { ...empty, url },
    gate,
    structuredData: writesStructuredData(binding) ? "mellox" : "site",
    canPublish: reason === null,
    reason,
    publication: existing ? publicationView(existing) : null,
  };
}

/* ───────────────────────── actions ───────────────────────── */

export async function approvePublication(
  ctx: PublishContext,
  args: { contentItemId: string; slug?: string; scheduledFor?: string | null; host?: string },
): Promise<PublicationView> {
  if (!ctx.canPropose) throw new HttpError(403, "Only editors can publish articles.");
  const preview = await previewPublication(ctx, args);
  if (!preview.canPublish || !preview.host || !preview.site)
    throw new HttpError(409, preview.reason ?? "This article can't be published yet.");
  const item = await loadItem(ctx.workspaceId, args.contentItemId);
  const article = toArticle(item, args.slug);
  const scheduledFor =
    args.scheduledFor && new Date(args.scheduledFor).getTime() > Date.now() + 60_000
      ? new Date(args.scheduledFor).toISOString()
      : null;
  const row = {
    workspace_id: ctx.workspaceId,
    content_item_id: args.contentItemId,
    host: preview.host,
    provider: preview.site.provider,
    slug: article.slug,
    title: article.title.slice(0, 300),
    status: "approved",
    status_detail: scheduledFor ? "Scheduled" : "Approved: publishing now",
    scheduled_for: scheduledFor,
    payload_hash: articleHash(article),
    approved_by: ctx.userId,
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    last_error: null,
    external_id: null,
    url: null,
    head_branch: null,
    pr_number: null,
    pr_url: null,
    verification: null,
    published_at: null,
    verified_at: null,
  };
  const { data, error } = await db
    .from("site_publications")
    .upsert(row, { onConflict: "workspace_id,content_item_id,host" })
    .select(PUBLICATION_COLS)
    .single();
  if (error) throw new HttpError(500, `Couldn't save the publication: ${error.message}`);
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "article.publish.approved",
    entity: "site_publication",
    payload: {
      publicationId: data.id,
      host: preview.host,
      provider: preview.site.provider,
      slug: article.slug,
    },
  });
  if (!scheduledFor) kickPublication(data.id);
  return publicationView(data as PublicationRow);
}

export async function cancelPublication(ctx: PublishContext, publicationId: string) {
  if (!ctx.canPropose) throw new HttpError(403, "Only editors can cancel publishing.");
  const { data } = await db
    .from("site_publications")
    .update({ status: "cancelled", status_detail: "Cancelled", lease_until: null })
    .eq("id", publicationId)
    .eq("workspace_id", ctx.workspaceId)
    .in("status", ["approved", "needs_attention", "failed"])
    .select(PUBLICATION_COLS)
    .maybeSingle();
  if (!data)
    throw new HttpError(
      409,
      "Only a publication that hasn't started (or needs attention) can be cancelled.",
    );
  return publicationView(data as PublicationRow);
}

/** Check a published (or stuck) article's live page again. */
export async function recheckPublication(ctx: PublishContext, publicationId: string) {
  if (!ctx.canPropose) throw new HttpError(403, "Only editors can do that.");
  const { data } = await db
    .from("site_publications")
    .update({
      status: "verifying",
      status_detail: "Checking the live page",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      lease_until: null,
    })
    .eq("id", publicationId)
    .eq("workspace_id", ctx.workspaceId)
    .in("status", ["needs_attention", "verified", "published"])
    .not("url", "is", null)
    .select(PUBLICATION_COLS)
    .maybeSingle();
  if (!data) throw new HttpError(409, "There's no live page to check yet.");
  kickPublication(data.id);
  return publicationView(data as PublicationRow);
}

export async function getPublication(ctx: PublishContext, publicationId: string) {
  const { data } = await (ctx.supabase as unknown as typeof db)
    .from("site_publications")
    .select(PUBLICATION_COLS)
    .eq("id", publicationId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Publication not found.");
  return publicationView(data as unknown as PublicationRow);
}

/* ───────────────────────── worker ───────────────────────── */

async function update(id: string, patch: Partial<PublicationRow> & Record<string, unknown>) {
  const { error } = await db.from("site_publications").update(patch).eq("id", id);
  if (error) console.error("[publish] update failed", id, error.message);
}

const backoffMs = (attempt: number) =>
  Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));

class NeedsAttention extends Error {}

async function publishWordPress(
  p: PublicationRow,
  a: PublishableArticle,
  blog: BlogSettingsRow,
  binding: SiteBinding | null,
) {
  const { clientFor } = await import("@/server/connectors/wordpress/service.server");
  const { client, siteUrl } = await clientFor(p.workspace_id);
  let post = p.external_id
    ? await client.getObject("post", Number(p.external_id)).catch(() => null)
    : null;
  if (!post) {
    const found = await client.findBySlug("post", a.slug);
    if (found && found.title.trim() !== a.title.trim())
      throw new NeedsAttention(
        `A post at “${a.slug}” already exists on WordPress. Change the address and publish again.`,
      );
    post = found;
  }
  const categories = [
    a.category
      ? await client.ensureTerm("categories", a.category).catch(() => null)
      : blog.wp_category_id,
  ].filter((x): x is number => typeof x === "number");
  const tags = (
    await Promise.all(a.tags.map((t) => client.ensureTerm("tags", t).catch(() => null)))
  ).filter((x): x is number => typeof x === "number");
  const body: Record<string, unknown> = {
    title: a.title,
    content: articleBodyHtml(a),
    excerpt: a.dek || a.metaDescription,
    slug: a.slug,
    status: "publish",
    ...(categories.length ? { categories } : {}),
    ...(tags.length ? { tags } : {}),
  };
  post = post
    ? await client.updateObject("post", post.id, body)
    : await client.createObject("post", body);
  await update(p.id, { external_id: String(post.id), url: post.link });

  // Search description and structured data where the site lets Mellox write them.
  const seo = binding?.provider === "wordpress" ? binding.seo : "none";
  const { brand } = await workspaceFacts(p.workspace_id);
  const origin = siteUrl.replace(/\/+$/, "");
  try {
    if (seo === "mellox") {
      const jsonld = articleJsonLd({
        article: a,
        url: post.link,
        origin,
        blogUrl: blog.blog_url && blog.blog_url !== origin ? blog.blog_url : null,
        brandName: brand,
        authorName: null,
        datePublished: new Date().toISOString(),
      });
      await client.send("mellox/v1/head", {
        type: "post",
        id: post.id,
        fields: { description: a.metaDescription, jsonld },
      });
    } else if (seo === "jetpack") {
      await client.updateObject("post", post.id, {
        meta: { advanced_seo_description: a.metaDescription },
      });
    } else if (seo === "rankmath") {
      await client.send("rankmath/v1/updateMeta", {
        objectType: "post",
        objectID: post.id,
        meta: { rank_math_description: a.metaDescription },
      });
    }
  } catch (error) {
    console.warn(
      "[publish] SEO fields not written",
      p.id,
      error instanceof Error ? error.message : error,
    );
  }
  return { url: post.link, externalId: String(post.id) };
}

async function publishWebflow(p: PublicationRow, a: PublishableArticle, blog: BlogSettingsRow) {
  const map = blog.webflow_field_map;
  if (!blog.webflow_collection_id || !map)
    throw new NeedsAttention("The Webflow blog collection is missing. Check the blog again.");
  const { webflowAccess } = await import("@/server/connectors/webflow/service.server");
  const api = await import("@/server/connectors/webflow/api.server");
  const { token } = await webflowAccess(p.workspace_id, { requireWrite: true });
  const faqHtml = a.faq.length
    ? a.faq.map((f) => `<h3>${escape(f.question)}</h3><p>${escape(f.answer)}</p>`).join("")
    : "";
  const fieldData: Record<string, unknown> = {
    [map.name]: a.title,
    [map.slug]: a.slug,
    [map.body]: map.faq ? articleBodyHtml({ ...a, faq: [] }) : articleBodyHtml(a),
  };
  if (map.summary) fieldData[map.summary] = (a.dek || a.metaDescription).slice(0, 256);
  if (map.metaDescription) fieldData[map.metaDescription] = a.metaDescription;
  if (map.faq && faqHtml) fieldData[map.faq] = faqHtml;

  let itemId = p.external_id;
  if (!itemId) {
    for (let offset = 0; offset < 1000 && !itemId; offset += 100) {
      const page = await api.listItemsPage(token, blog.webflow_collection_id, offset);
      const hit = (page.items ?? []).find((i) => i.fieldData.slug === a.slug);
      if (hit) {
        if (String(hit.fieldData.name ?? "").trim() !== a.title.trim())
          throw new NeedsAttention(
            `A blog post at “${a.slug}” already exists in Webflow. Change the address and publish again.`,
          );
        itemId = hit.id;
      }
      if ((page.items ?? []).length < 100) break;
    }
  }
  const item = itemId
    ? await api.updateItemLive(token, blog.webflow_collection_id, itemId, fieldData)
    : await api.createItemLive(token, blog.webflow_collection_id, fieldData);
  const url = webflowItemUrl(`https://${p.host}`, map.collectionSlug, a.slug);
  await update(p.id, { external_id: item.id, url });
  return { url, externalId: item.id };
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function publishGithub(p: PublicationRow, a: PublishableArticle, blog: BlogSettingsRow) {
  if (!blog.source_id || !blog.content_dir || !blog.post_format)
    throw new NeedsAttention("The repository's blog folder is missing. Check the blog again.");
  const git = await import("@/server/connectors/github/git.server");
  const { postBranchName } = await import("@/server/connectors/github/paths");
  const { withAccess } = await import("@/server/connectors/github/service.server");
  const fixes = await import("@/server/geo/fixes/service.server");
  const ctx = {
    supabase: supabaseAdmin as never,
    userId: p.approved_by ?? "",
    workspaceId: p.workspace_id,
    canPropose: true,
    canManage: true,
  };
  const { source, connection } = await fixes.loadSourceWithConnection(ctx, blog.source_id);
  fixes.assertSourceOwnsHost(source, p.host);
  const installationId = connection.external_account_id;
  const repo = source.full_name;
  const baseBranch = source.branch ?? source.default_branch ?? "main";
  const file = githubPostFile(
    a,
    { contentDir: blog.content_dir, format: blog.post_format },
    blog.frontmatter?.keys ?? [],
    new Date().toISOString(),
  );
  const url = `https://${p.host}${blog.route_prefix ?? "/blog"}/${a.slug}`;

  let headBranch = p.head_branch;
  const branchExists = headBranch
    ? !!(await git.getBranch(installationId, repo, headBranch))
    : false;
  if (!branchExists) {
    const base = await git.getBranch(installationId, repo, baseBranch);
    if (!base) throw new NeedsAttention(`Branch ${baseBranch} no longer exists in ${repo}.`);
    const clash = await git.readFile(installationId, repo, file.path, base.sha).catch(() => null);
    if (clash)
      throw new NeedsAttention(
        `${file.path} already exists in ${repo}. Change the address and publish again.`,
      );
    headBranch = headBranch ?? postBranchName(a.slug, randomBytes(4).toString("hex"));
    await update(p.id, { head_branch: headBranch });
    await withAccess(connection, p.approved_by, () =>
      git.commitToNewBranch({
        installationId,
        repo,
        baseBranch,
        baseSha: base.sha,
        headBranch: headBranch!,
        message: `Add blog post: ${a.title}\n\nWritten in Mellox Studio and approved for publishing.`,
        files: [file],
        maxFiles: 1,
      }),
    );
  }
  const pr = await withAccess(connection, p.approved_by, () =>
    git.createPullRequest({
      installationId,
      repo,
      headBranch: headBranch!,
      baseBranch,
      title: `Blog post: ${a.title}`,
      body: `Adds \`${file.path}\`, written in Mellox Studio and approved for publishing.\n\nOnce merged and deployed it should appear at ${url}. Mellox checks the live page after the merge.\n\nMeta description: ${a.metaDescription}`,
    }),
  );
  await update(p.id, { url, pr_number: pr.number, pr_url: pr.url });
  return { url, pr };
}

async function publishOne(p: PublicationRow) {
  await update(p.id, { status: "publishing", status_detail: "Publishing to your site" });
  const item = await loadItem(p.workspace_id, p.content_item_id);
  const article = toArticle(item, p.slug);
  if (p.payload_hash && articleHash(article) !== p.payload_hash)
    throw new NeedsAttention(
      "The article changed after it was approved. Approve publishing again.",
    );
  const resolution = await resolveSite(p.workspace_id, p.host);
  const binding = resolution.binding;
  if (!binding || binding.provider !== p.provider || !binding.verified)
    throw new NeedsAttention(
      `Mellox can no longer confirm that your ${p.provider} account builds ${p.host}.`,
    );
  const blog = await loadBlogSettings(p.workspace_id, p.host);
  if (!blog || !blogReady(blog))
    throw new NeedsAttention("Your site's blog isn't set up any more.");

  if (p.provider === "github") {
    const { pr } = await publishGithub(p, article, blog);
    await update(p.id, {
      status: "pr_open",
      status_detail: `Pull request #${pr.number} is open. Merge it to publish.`,
      attempts: 0,
      next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      lease_until: null,
      last_error: null,
    });
    return;
  }
  if (p.provider === "wordpress") await publishWordPress(p, article, blog, binding);
  else await publishWebflow(p, article, blog);
  await update(p.id, {
    status: "published",
    status_detail: "Published. Checking the live page",
    published_at: new Date().toISOString(),
    attempts: 0,
    next_attempt_at: new Date(Date.now() + 20_000).toISOString(),
    lease_until: null,
    last_error: null,
  });
  await db
    .from("content_items")
    .update({ status: "published" })
    .eq("id", p.content_item_id)
    .eq("workspace_id", p.workspace_id);
  await recordAudit({
    workspaceId: p.workspace_id,
    userId: p.approved_by,
    action: "article.published",
    entity: "site_publication",
    payload: { publicationId: p.id, host: p.host, provider: p.provider },
  });
}

async function verifyOne(p: PublicationRow) {
  if (!p.url) throw new NeedsAttention("There's no live address to check.");
  await update(p.id, { status: "verifying", status_detail: "Checking the live page" });
  const item = await loadItem(p.workspace_id, p.content_item_id);
  const article = toArticle(item, p.slug);
  const resolution = await resolveSite(p.workspace_id, p.host);
  const expectStructuredData = writesStructuredData(resolution.binding);
  let status = 0;
  let html = "";
  try {
    const target = new URL(p.url);
    target.searchParams.set("mellox_verify", String(Date.now()));
    const res = await safeFetch(target, {
      timeoutMs: 20_000,
      maxBytes: 3_000_000,
      onOverflow: "truncate",
    });
    status = res.status;
    html = res.text();
  } catch (error) {
    html = "";
    status = 0;
    console.warn(
      "[publish] live fetch failed",
      p.id,
      error instanceof Error ? error.message : error,
    );
  }
  const result = verifyArticleHtml(html, p.url, article, { status, expectStructuredData });
  const checks = result.checks.map((c) => ({ label: c.label, ok: c.ok, detail: c.detail }));
  if (result.ok) {
    await update(p.id, {
      status: "verified",
      status_detail: "Live on your site",
      verified_at: new Date().toISOString(),
      verification: { checks },
      lease_until: null,
      last_error: null,
    });
    return;
  }
  const failed = result.checks.filter((c) => !c.ok && c.blocking).map((c) => c.label.toLowerCase());
  const detail = result.placeholder
    ? `${p.host} shows visitors a “coming soon” page, so the article can't be seen yet.`
    : `Not visible yet: ${failed.join(", ")}.`;
  if (p.attempts >= p.max_attempts || result.placeholder) {
    await update(p.id, {
      status: "needs_attention",
      status_detail:
        p.provider === "webflow" && failed.includes("shows the article")
          ? "The post is live in Webflow but its page doesn't show the article. Add the Post Body field to the blog template page in the Webflow Designer, publish, then check again."
          : detail,
      verification: { checks },
      lease_until: null,
    });
    return;
  }
  await update(p.id, {
    status: "verifying",
    status_detail: `${detail} Checking again shortly (pages can take a few minutes to update).`,
    verification: { checks },
    next_attempt_at: new Date(Date.now() + backoffMs(p.attempts)).toISOString(),
    lease_until: null,
  });
}

/** GitHub: follow the pull request (webhooks may not reach this server). */
async function pollOpenPullRequests(max = 5) {
  const { data } = await db
    .from("site_publications")
    .select(PUBLICATION_COLS)
    .eq("status", "pr_open")
    .lte("next_attempt_at", new Date().toISOString())
    .limit(max);
  for (const p of (data ?? []) as PublicationRow[]) {
    try {
      const blog = await loadBlogSettings(p.workspace_id, p.host);
      if (!blog?.source_id || !p.pr_number) continue;
      const git = await import("@/server/connectors/github/git.server");
      const { data: source } = await db
        .from("workspace_sources")
        .select("full_name, connection_id")
        .eq("id", blog.source_id)
        .single();
      const { data: conn } = await db
        .from("workspace_connections")
        .select("external_account_id")
        .eq("id", source.connection_id)
        .single();
      const pr = await git.getPullRequest(
        String(conn.external_account_id),
        source.full_name,
        p.pr_number,
      );
      await applyPullRequestState(p, pr?.state ?? "open");
    } catch (error) {
      await update(p.id, {
        next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1900),
      });
    }
  }
}

async function applyPullRequestState(p: PublicationRow, state: "open" | "closed" | "merged") {
  if (state === "merged") {
    await update(p.id, {
      status: "published",
      status_detail: "Merged. Checking the live page after the deploy",
      published_at: new Date().toISOString(),
      attempts: 0,
      // Give the site a few minutes to build and deploy.
      next_attempt_at: new Date(Date.now() + 3 * 60_000).toISOString(),
      lease_until: null,
    });
    await db
      .from("content_items")
      .update({ status: "published" })
      .eq("id", p.content_item_id)
      .eq("workspace_id", p.workspace_id);
  } else if (state === "closed") {
    await update(p.id, {
      status: "cancelled",
      status_detail: "The pull request was closed without merging.",
    });
  } else {
    await update(p.id, { next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  }
}

/** Webhook: a mellox/post- pull request changed. */
export async function handlePublicationPullRequest(
  connectionIds: string[],
  pr: { number: number; state: "open" | "closed" | "merged"; headRef: string },
): Promise<number> {
  if (!connectionIds.length) return 0;
  const { data } = await db
    .from("site_publications")
    .select(PUBLICATION_COLS)
    .eq("status", "pr_open")
    .eq("pr_number", pr.number)
    .eq("head_branch", pr.headRef);
  let touched = 0;
  for (const p of (data ?? []) as PublicationRow[]) {
    await applyPullRequestState(p, pr.state);
    touched++;
  }
  return touched;
}

async function runOne(p: PublicationRow) {
  try {
    if (p.status === "approved" || p.status === "publishing") await publishOne(p);
    else await verifyOne(p);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1900);
    if (error instanceof NeedsAttention || p.attempts >= p.max_attempts) {
      await update(p.id, {
        status: error instanceof NeedsAttention ? "needs_attention" : "failed",
        status_detail:
          error instanceof NeedsAttention ? message.slice(0, 900) : "Publishing failed. Try again.",
        last_error: message,
        lease_until: null,
      });
    } else {
      await update(p.id, {
        last_error: message,
        status_detail: "Couldn't reach your site. Trying again shortly.",
        next_attempt_at: new Date(Date.now() + backoffMs(p.attempts)).toISOString(),
        lease_until: null,
      });
    }
    console.error("[publish] step failed", p.id, message);
  }
}

export async function runDuePublications(opts: { budgetMs: number; max?: number; id?: string }) {
  const deadline = Date.now() + opts.budgetMs;
  let handled = 0;
  if (!opts.id)
    await pollOpenPullRequests().catch((e) => console.error("[publish] PR poll failed", e));
  while (Date.now() < deadline - 25_000 && handled < (opts.max ?? 4)) {
    const { data, error } = await db.rpc("claim_site_publications", {
      p_worker: WORKER,
      p_max: 1,
      p_lease_seconds: 120,
      p_id: opts.id ?? null,
    });
    if (error) throw new Error(`claim_site_publications: ${error.message}`);
    const rows = (data ?? []) as PublicationRow[];
    if (!rows.length) break;
    await runOne(rows[0]);
    handled++;
    if (opts.id) {
      // Follow the same publication through publish → verify in one go when it's due.
      const { data: next } = await db
        .from("site_publications")
        .select("status, next_attempt_at")
        .eq("id", opts.id)
        .single();
      if (!next || !["published", "verifying"].includes(next.status)) break;
      const wait = new Date(next.next_attempt_at).getTime() - Date.now();
      if (wait > 60_000 || Date.now() + wait > deadline - 25_000) break;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
  return { handled };
}

export function kickPublication(id: string): void {
  after(async () => {
    try {
      await runDuePublications({ id, budgetMs: 200_000, max: 3 });
    } catch (error) {
      console.error(`[publish] kick ${id} failed`, error);
    }
  });
}
