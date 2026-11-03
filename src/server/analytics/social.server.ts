// social.server.ts — Analytics → Social: the brand's own social accounts,
// read from stored feed rows (social_account_posts, filled by
// src/lib/postforme/feeds.ts). Reads use the caller's RLS client. No Google
// connection is needed for any of it.
//
// The one write: accounts that were never read are read once in after(), with
// the service role, for the verified workspace id. It is a provider read, not
// a paid call, and the sweep would do the same within minutes.
import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { resolveRange, todayIn, type RangeInput } from "@/lib/analytics/ranges";
import type { SocialReport } from "@/lib/analytics/types";
import {
  buildSocialReport,
  emptySocialReport,
  type StoredSocialPost,
} from "@/lib/social-insights/report";

type Db = SupabaseClient<Database>;

type AccountRow = {
  id: string;
  platform: string;
  username: string | null;
  display_name: string | null;
  status: string;
  feed_synced_at: string | null;
};

export async function getSocialReport(
  db: Db,
  workspaceId: string,
  input: RangeInput,
): Promise<SocialReport> {
  const sb = db as any;
  const range = resolveRange(input, todayIn("UTC"));
  const [accountsRes, postsRes, firstRes] = await Promise.all([
    sb
      .from("social_accounts")
      .select("id, platform, username, display_name, status, feed_synced_at")
      .eq("workspace_id", workspaceId)
      .eq("provider", "postforme")
      .neq("status", "disconnected"),
    sb
      .from("social_account_posts")
      .select(
        "id, social_account_id, platform, url, caption, thumbnail_url, format, posted_at, metrics, content_item_id",
      )
      .eq("workspace_id", workspaceId)
      .gte("posted_at", `${range.previous.from}T00:00:00Z`)
      .order("posted_at", { ascending: false })
      .limit(2000),
    sb
      .from("social_account_posts")
      .select("posted_at")
      .eq("workspace_id", workspaceId)
      .not("posted_at", "is", null)
      .order("posted_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (postsRes.error) throw new Error(postsRes.error.message);

  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const active = accounts.filter((a) => a.status === "active");
  const lastSyncedAt =
    accounts
      .map((a) => a.feed_synced_at)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null;
  const rows = (postsRes.data ?? []) as Array<
    Omit<StoredSocialPost, "account"> & { social_account_id: string }
  >;
  const status: SocialReport["status"] = {
    state: "ready",
    accounts: active.length,
    reconnect: accounts.filter((a) => a.status === "reconnect_required").length,
    lastSyncedAt,
  };
  const provider = getDistributionProviderForWorkspace(workspaceId);

  if (!rows.length && !lastSyncedAt) {
    if (provider !== "postforme") return emptySocialReport({ ...status, state: "unavailable" });
    if (!active.length) return emptySocialReport({ ...status, state: "no_accounts" });
    readNeverReadAccounts(workspaceId, active);
    return emptySocialReport({ ...status, state: "syncing" });
  }
  if (provider === "postforme") readNeverReadAccounts(workspaceId, active);

  const label = new Map(
    accounts.map((a) => [a.id, a.username ? `@${a.username}` : (a.display_name ?? null)]),
  );
  const posts: StoredSocialPost[] = rows.map((r) => ({
    ...r,
    account: label.get(r.social_account_id) ?? null,
  }));
  const first = (firstRes.data as { posted_at: string } | null)?.posted_at?.slice(0, 10) ?? null;
  return buildSocialReport({ posts, range, status, firstPostedDate: first });
}

/** Accounts connected since the last sweep get read right away, once. */
function readNeverReadAccounts(workspaceId: string, active: AccountRow[]) {
  if (!active.some((a) => !a.feed_synced_at)) return;
  try {
    after(async () => {
      const [{ syncWorkspaceFeeds }, { getPostForMeDeps }] = await Promise.all([
        import("@/lib/postforme/feeds"),
        import("@/lib/postforme/workspace.server"),
      ]);
      const deps = getPostForMeDeps(workspaceId);
      const { data } = await deps.db
        .from("social_accounts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("provider", "postforme")
        .eq("status", "active")
        .is("feed_synced_at", null)
        .limit(1);
      if ((data ?? []).length) await syncWorkspaceFeeds(workspaceId, deps);
    });
  } catch {
    // Outside a request (tests): the sweep reads it instead.
  }
}
