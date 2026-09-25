import "server-only";
// blog.server.ts — find (or set up) where a website keeps its articles.
//
//   WordPress  posts always exist; the blog URL is the posts page when one is set
//   Webflow    the CMS collection that looks like a blog (lib/articles/blog.ts);
//              none → Mellox can create "Blog Posts" in one click, after which
//              the person designs its template page in Webflow (needs_design)
//   GitHub     the folder existing posts live in, their format and frontmatter;
//              none → the person's developer adds one (Mellox won't invent a
//              routing layer in someone's codebase)
//
// Results are stored in site_blog_settings (service role; members read).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  detectGithubBlog,
  frontmatterKeys,
  pickWebflowBlogCollection,
  webflowFieldMap,
  type WebflowFieldMap,
} from "@/lib/articles/blog";
import type { BlogStatus, BlogView } from "@/lib/articles/contracts";
import type { SiteBinding } from "@/server/sites/resolve.server";
import { HttpError } from "@/server/http-error";

const db = supabaseAdmin as unknown as { from: (table: string) => any };

export type BlogSettingsRow = {
  id: string;
  workspace_id: string;
  host: string;
  provider: "github" | "wordpress" | "webflow";
  status: BlogStatus;
  status_detail: string | null;
  blog_url: string | null;
  wp_posts_page_id: number | null;
  wp_category_id: number | null;
  webflow_collection_id: string | null;
  webflow_field_map: (WebflowFieldMap & { collectionSlug: string; collectionName: string }) | null;
  source_id: string | null;
  content_dir: string | null;
  post_format: "md" | "mdx" | null;
  route_prefix: string | null;
  frontmatter: { keys: string[] } | null;
  detected_at: string | null;
};

const COLS =
  "id, workspace_id, host, provider, status, status_detail, blog_url, wp_posts_page_id, wp_category_id, webflow_collection_id, webflow_field_map, source_id, content_dir, post_format, route_prefix, frontmatter, detected_at";

const DETECT_TTL_MS = 30 * 60_000;
const READY: BlogStatus[] = ["detected", "created"];

export const blogReady = (b: BlogSettingsRow | null) => !!b && READY.includes(b.status);

export async function loadBlogSettings(workspaceId: string, host: string) {
  const { data } = await db
    .from("site_blog_settings")
    .select(COLS)
    .eq("workspace_id", workspaceId)
    .eq("host", host)
    .maybeSingle();
  return (data as BlogSettingsRow | null) ?? null;
}

async function save(workspaceId: string, host: string, patch: Partial<BlogSettingsRow>) {
  const { data, error } = await db
    .from("site_blog_settings")
    .upsert(
      { workspace_id: workspaceId, host, ...patch, detected_at: new Date().toISOString() },
      { onConflict: "workspace_id,host" },
    )
    .select(COLS)
    .single();
  if (error) throw new HttpError(500, `Couldn't save blog settings: ${error.message}`);
  return data as BlogSettingsRow;
}

export function blogView(b: BlogSettingsRow): BlogView {
  const destination =
    b.provider === "wordpress"
      ? "WordPress posts"
      : b.provider === "webflow"
        ? b.webflow_field_map
          ? `the “${b.webflow_field_map.collectionName}” collection`
          : null
        : b.content_dir;
  return {
    provider: b.provider,
    status: b.status,
    detail: b.status_detail,
    blogUrl: b.blog_url,
    canCreate: b.provider === "webflow" && (b.status === "missing" || b.status === "failed"),
    destination,
  };
}

/* ───────────────────────── detection ───────────────────────── */

async function detectWordPress(workspaceId: string, host: string) {
  const { clientFor } = await import("@/server/connectors/wordpress/service.server");
  const { client, siteUrl } = await clientFor(workspaceId);
  const origin = siteUrl.replace(/\/+$/, "");
  let blogUrl = origin;
  let postsPage: number | null = null;
  let category: number | null = null;
  try {
    const s = await client.getSettings();
    category = s.default_category ?? null;
    if (s.show_on_front === "page" && s.page_for_posts) {
      postsPage = s.page_for_posts;
      blogUrl = (await client.getObject("page", s.page_for_posts)).link || origin;
    }
  } catch {
    // Settings need manage_options; posts still publish without them.
  }
  return save(workspaceId, host, {
    provider: "wordpress",
    status: "detected",
    status_detail: null,
    blog_url: blogUrl,
    wp_posts_page_id: postsPage,
    wp_category_id: category,
  });
}

async function detectWebflow(workspaceId: string, host: string) {
  const { webflowAccess } = await import("@/server/connectors/webflow/service.server");
  const api = await import("@/server/connectors/webflow/api.server");
  const { token, site } = await webflowAccess(workspaceId);
  const list = (await api.listCollections(token, site.id)).collections ?? [];
  const full = await Promise.all(list.slice(0, 20).map((c) => api.getCollection(token, c.id)));
  const found = pickWebflowBlogCollection(full);
  const existing = await loadBlogSettings(workspaceId, host);
  if (!found) {
    return save(workspaceId, host, {
      provider: "webflow",
      status: "missing",
      status_detail: "Your Webflow site has no blog collection yet. Mellox can create one.",
      webflow_collection_id: null,
      webflow_field_map: null,
      blog_url: null,
    });
  }
  const slug = found.collection.slug ?? "blog";
  // A collection Mellox created stays "needs_design" until the person says the template is ready.
  const keep =
    existing?.webflow_collection_id === found.collection.id &&
    (existing.status === "needs_design" || existing.status === "created")
      ? existing.status
      : "detected";
  return save(workspaceId, host, {
    provider: "webflow",
    status: keep,
    status_detail:
      keep === "needs_design"
        ? `Open the “${found.collection.displayName ?? "Blog Posts"} Template” page in the Webflow Designer, add the Post Body field to it and publish once. Then tell Mellox it's ready.`
        : null,
    webflow_collection_id: found.collection.id,
    webflow_field_map: {
      ...found.map,
      collectionSlug: slug,
      collectionName: found.collection.displayName ?? "Blog",
    },
    blog_url: `https://${host}/${slug}`,
  });
}

async function detectGithub(
  workspaceId: string,
  host: string,
  binding: Extract<SiteBinding, { provider: "github" }>,
) {
  const git = await import("@/server/connectors/github/git.server");
  const { data: source } = await db
    .from("workspace_sources")
    .select("id, full_name, default_branch, branch, connection_id")
    .eq("id", binding.sourceId)
    .eq("workspace_id", workspaceId)
    .single();
  const { data: conn } = await db
    .from("workspace_connections")
    .select("external_account_id")
    .eq("id", source.connection_id)
    .single();
  const installationId = String(conn.external_account_id);
  const branchName = source.branch ?? source.default_branch ?? "main";
  const branch = await git.getBranch(installationId, source.full_name, branchName);
  if (!branch)
    throw new HttpError(409, `Branch ${branchName} was not found in ${source.full_name}.`);
  const { paths } = await git.getTreePaths(installationId, source.full_name, branch.treeSha);
  const layout = detectGithubBlog(paths);
  if (!layout) {
    return save(workspaceId, host, {
      provider: "github",
      status: "missing",
      status_detail: `No blog posts folder found in ${source.full_name}. Ask your developer to add one (for example content/blog with a page that lists its posts), then check again.`,
      source_id: source.id,
      content_dir: null,
      post_format: null,
      route_prefix: null,
      frontmatter: null,
      blog_url: null,
    });
  }
  let keys: string[] = [];
  for (const example of layout.examples) {
    const file = await git
      .readFile(installationId, source.full_name, example, branch.sha)
      .catch(() => null);
    keys = file ? frontmatterKeys(file.content) : [];
    if (keys.length) break;
  }
  return save(workspaceId, host, {
    provider: "github",
    status: "detected",
    status_detail: null,
    source_id: source.id,
    content_dir: layout.contentDir,
    post_format: layout.format,
    route_prefix: layout.routePrefix,
    frontmatter: { keys },
    blog_url: `https://${host}${layout.routePrefix}`,
  });
}

/** Where articles go on this site; re-detected when stale or forced. */
export async function ensureBlogSettings(
  workspaceId: string,
  host: string,
  binding: SiteBinding,
  opts: { force?: boolean } = {},
): Promise<BlogSettingsRow> {
  const existing = await loadBlogSettings(workspaceId, host);
  const fresh =
    existing &&
    existing.provider === binding.provider &&
    existing.detected_at &&
    Date.now() - new Date(existing.detected_at).getTime() < DETECT_TTL_MS &&
    existing.status !== "failed";
  if (fresh && !opts.force) return existing;
  try {
    if (binding.provider === "wordpress") return await detectWordPress(workspaceId, host);
    if (binding.provider === "webflow") return await detectWebflow(workspaceId, host);
    return await detectGithub(workspaceId, host, binding);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't check the blog.";
    return save(workspaceId, host, {
      provider: binding.provider,
      status: "failed",
      status_detail: message.slice(0, 900),
    });
  }
}

/* ───────────────────────── setup ───────────────────────── */

/** Webflow: create a "Blog Posts" collection with the fields articles need. */
export async function createWebflowBlog(
  workspaceId: string,
  host: string,
): Promise<BlogSettingsRow> {
  const { webflowAccess } = await import("@/server/connectors/webflow/service.server");
  const api = await import("@/server/connectors/webflow/api.server");
  const { token, site } = await webflowAccess(workspaceId, { requireWrite: true });
  await save(workspaceId, host, { provider: "webflow", status: "creating", status_detail: null });
  try {
    const created = await api.createCollection(token, site.id, {
      displayName: "Blog Posts",
      singularName: "Blog Post",
      slug: "blog",
      fields: [
        { type: "RichText", displayName: "Post Body", helpText: "The article. Written by Mellox." },
        { type: "PlainText", displayName: "Post Summary", helpText: "One-sentence summary." },
        { type: "PlainText", displayName: "Meta Description", helpText: "Search description." },
      ],
    });
    const collection = await api.getCollection(token, created.id);
    const map = webflowFieldMap(collection);
    if (!map) throw new HttpError(502, "Webflow created the collection without its fields.");
    return save(workspaceId, host, {
      provider: "webflow",
      status: "needs_design",
      status_detail:
        "Blog created. In the Webflow Designer, open the “Blog Posts Template” page, add the Post Body field to it and publish once. Then tell Mellox it's ready.",
      webflow_collection_id: collection.id,
      webflow_field_map: {
        ...map,
        collectionSlug: collection.slug ?? "blog",
        collectionName: "Blog Posts",
      },
      blog_url: `https://${host}/${collection.slug ?? "blog"}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webflow refused the new collection.";
    await save(workspaceId, host, {
      provider: "webflow",
      status: "failed",
      status_detail: message.slice(0, 900),
    });
    throw error;
  }
}

/** The person designed the Webflow template page. */
export async function markBlogReady(workspaceId: string, host: string): Promise<BlogSettingsRow> {
  const b = await loadBlogSettings(workspaceId, host);
  if (!b || b.status !== "needs_design")
    throw new HttpError(409, "There's no blog waiting for design.");
  return save(workspaceId, host, { status: "created", status_detail: null });
}
