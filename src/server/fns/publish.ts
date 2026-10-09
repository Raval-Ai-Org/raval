import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { isProofEngineEnabled } from "@/lib/feature-flags";
import {
  buildPublishQueue,
  type ContentRow,
  type PublicationRow,
  type PullRequestRow,
} from "@/lib/publish/queue";

// The Publish list (Share → Publish). Reads rows that already exist with the
// caller's own client, so RLS decides what they may see. It starts nothing,
// spends nothing and changes nothing.

type Rows<T> = { data: T[] | null; error: { message: string } | null };

const OUT_STATUSES = ["approved", "scheduled", "publishing", "failed", "partial_failed"];
const PUBLICATION_STATUSES = [
  "approved",
  "publishing",
  "pr_open",
  "published",
  "verifying",
  "needs_attention",
  "failed",
];

export const getPublishQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    // Several of these tables are newer than the generated types.
    const db = context.supabase as unknown as {
      from: (table: string) => {
        select: (columns: string) => any;
      };
    };
    const ws = data.workspaceId;

    const [content, publications, fixes, batches, blogs, deliveries] = (await Promise.all([
      db
        .from("content_items")
        .select("id, title, body, kind, channel, status, scheduled_at, updated_at")
        .eq("workspace_id", ws)
        .in("status", OUT_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(100),
      db
        .from("site_publications")
        .select("id, content_item_id, title, host, status, status_detail, url, pr_url, updated_at")
        .eq("workspace_id", ws)
        .in("status", PUBLICATION_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(30),
      // A fix that belongs to a "Fix all" run is listed once, as its run.
      db
        .from("geo_fix_proposals")
        .select("id, page_url, pr_url, pr_number, updated_at")
        .eq("workspace_id", ws)
        .eq("status", "pr_open")
        .is("batch_id", null)
        .order("updated_at", { ascending: false })
        .limit(20),
      db
        .from("geo_fix_batches")
        .select("id, host, pr_url, pr_number, updated_at")
        .eq("workspace_id", ws)
        .eq("status", "pr_open")
        .order("updated_at", { ascending: false })
        .limit(10),
      db
        .from("site_blog_settings")
        .select("id, host, setup, updated_at")
        .eq("workspace_id", ws)
        .eq("status", "creating")
        .limit(5),
      isProofEngineEnabled(ws)
        ? db
            .from("experiment_deliveries")
            .select("id, kind, pr_url, pr_number, updated_at")
            .eq("workspace_id", ws)
            .eq("status", "pr_open")
            .order("updated_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [], error: null }),
    ])) as [Rows<ContentRow>, Rows<PublicationRow>, Rows<any>, Rows<any>, Rows<any>, Rows<any>];

    // Posts are the heart of the list: without them it would read as "nothing
    // waiting", which is the one thing it must not say by mistake.
    if (content.error) throw new Error("Could not load what's ready to publish");

    const pullRequests: PullRequestRow[] = [
      ...(fixes.data ?? []).map((row) => ({
        id: String(row.id),
        source: "fix" as const,
        label: typeof row.page_url === "string" ? `Website fix · ${pathOf(row.page_url)}` : null,
        pr_url: row.pr_url ?? null,
        pr_number: row.pr_number ?? null,
        updated_at: row.updated_at ?? null,
      })),
      ...(batches.data ?? []).map((row) => ({
        id: String(row.id),
        source: "fix_batch" as const,
        label: row.host ? `Website fixes · ${row.host}` : null,
        pr_url: row.pr_url ?? null,
        pr_number: row.pr_number ?? null,
        updated_at: row.updated_at ?? null,
      })),
      ...(blogs.data ?? []).map((row) => {
        const setup = (row.setup ?? {}) as { prUrl?: unknown; prNumber?: unknown };
        return {
          id: String(row.id),
          source: "blog" as const,
          label: row.host ? `New blog pages · ${row.host}` : null,
          pr_url: typeof setup.prUrl === "string" ? setup.prUrl : null,
          pr_number: typeof setup.prNumber === "number" ? setup.prNumber : null,
          updated_at: row.updated_at ?? null,
        };
      }),
      ...(deliveries.data ?? []).map((row) => ({
        id: String(row.id),
        source: "experiment" as const,
        label: row.kind === "integration" ? "Experiments setup" : null,
        pr_url: row.pr_url ?? null,
        pr_number: row.pr_number ?? null,
        updated_at: row.updated_at ?? null,
      })),
    ].filter((row) => isGitHubPullRequest(row.pr_url));

    return buildPublishQueue({
      content: content.data ?? [],
      publications: (publications.data ?? []).map((row) => ({
        ...row,
        pr_url: isGitHubPullRequest(row.pr_url) ? row.pr_url : null,
        url: isHttpsUrl(row.url) ? row.url : null,
      })),
      pullRequests,
    });
  });

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "page";
  }
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Links in this list open in the browser, so only a real GitHub pull request is passed on. */
function isGitHubPullRequest(value: unknown): value is string {
  if (!isHttpsUrl(value)) return false;
  const url = new URL(value);
  return url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/pull\/\d+$/.test(url.pathname);
}
