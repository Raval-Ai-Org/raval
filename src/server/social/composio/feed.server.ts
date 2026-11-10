// Analytics → Social for Composio-connected accounts (Instagram, Facebook
// Pages, YouTube, Pinterest): read what each destination posted, with the
// network's numbers, into social_account_posts — the same rows Post for Me's
// feed fills (src/lib/postforme/feeds.ts), so the report treats every account
// the same.
//
// Every read goes through runIntegrationTool (account, allow-list, rate limit,
// call log). Advanced by the existing sdr-reconcile sweep (each account at
// most every FEED_EVERY_MS), by Analytics' "Refresh", and once right after a
// connection. No cron job of its own. Written with the service role.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isIntegrationsEnabled } from "@/lib/feature-flags";
import {
  FEED_EVERY_MS,
  storeFeedEntries,
  type FeedAccount,
  type FeedSyncResult,
} from "@/lib/postforme/feeds";
import { parseDestinationAccountId } from "@/lib/social/composio/destinations";
import {
  feedListCall,
  feedPlatformOf,
  insightsCall,
  mergeInsights,
  readFeed,
} from "@/lib/social/composio/feed";
import { runIntegrationTool } from "@/server/integrations/execute.server";

// Read on each call, so tests can swap the client in.
const db = {
  from: (table: string) => (supabaseAdmin as unknown as { from: (t: string) => any }).from(table),
};

type Row = FeedAccount & { integration_account_id: string | null; connected_by: string | null };

const COLS =
  "id, workspace_id, provider_account_id, platform, integration_account_id, connected_by";

/** Read and store one destination's posts. Returns how many posts were stored. */
export async function syncComposioAccountFeed(account: Row): Promise<number> {
  const platform = feedPlatformOf(account.platform);
  const parsed = parseDestinationAccountId(account.provider_account_id);
  if (!platform || !parsed) return 0;
  const integrationAccountId = account.integration_account_id ?? parsed.integrationAccountId;
  const caller = { kind: "worker" as const, actingUserId: account.connected_by };
  const run = (tool: string, args: Record<string, unknown>) =>
    runIntegrationTool({
      workspaceId: account.workspace_id,
      accountId: integrationAccountId,
      tool,
      arguments: args,
      caller,
      purpose: "feed",
    });

  const call = feedListCall(platform, parsed.destination);
  const listed = await run(call.tool, call.args);
  if (!listed.successful) throw new Error(`${call.tool}: ${listed.error ?? "no result"}`);
  let entries = readFeed(platform, listed.data);

  // Views and reach come from a separate read per post (or one batch); a
  // failed one keeps the numbers the list gave.
  const newest = [...entries]
    .sort((a, b) => String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")))
    .map((e) => e.platform_post_id as string);
  for (const extra of insightsCall(platform, newest)) {
    try {
      const result = await run(extra.tool, extra.args);
      if (result.successful) entries = mergeInsights(platform, entries, extra, result.data);
    } catch {
      /* Numbers from the list stand. */
    }
  }
  return storeFeedEntries(account, entries, { db });
}

async function syncAll(accounts: Row[]): Promise<FeedSyncResult> {
  let posts = 0;
  let failed = 0;
  let read = 0;
  for (const account of accounts) {
    if (!feedPlatformOf(account.platform) || !isIntegrationsEnabled(account.workspace_id)) continue;
    read++;
    try {
      posts += await syncComposioAccountFeed(account);
    } catch (e) {
      failed++;
      console.error(
        "[composio-social] feed sync failed",
        account.id,
        e instanceof Error ? e.message : String(e),
      );
      // Try again on a later sweep, not on the very next one.
      await db
        .from("social_accounts")
        .update({ feed_synced_at: new Date().toISOString() })
        .eq("id", account.id);
    }
  }
  return { accounts: read, posts, failed };
}

/** Every active Composio account of one workspace (Analytics' "Refresh", a new connection). */
export async function syncComposioWorkspaceFeeds(
  workspaceId: string,
  opts: { onlyNeverRead?: boolean } = {},
): Promise<FeedSyncResult> {
  let query = db
    .from("social_accounts")
    .select(COLS)
    .eq("workspace_id", workspaceId)
    .eq("provider", "composio")
    .eq("status", "active");
  if (opts.onlyNeverRead) query = query.is("feed_synced_at", null);
  const { data } = await query.limit(20);
  return syncAll((data ?? []) as Row[]);
}

/** The sweep: the accounts read longest ago, each at most every FEED_EVERY_MS. */
export async function syncDueComposioFeeds(
  opts: { maxAccounts?: number; now?: number } = {},
): Promise<FeedSyncResult> {
  const cutoff = new Date((opts.now ?? Date.now()) - FEED_EVERY_MS).toISOString();
  const { data } = await db
    .from("social_accounts")
    .select(COLS)
    .eq("provider", "composio")
    .eq("status", "active")
    .in("platform", ["instagram", "facebook", "youtube", "pinterest"])
    .or(`feed_synced_at.is.null,feed_synced_at.lt.${cutoff}`)
    .order("feed_synced_at", { ascending: true, nullsFirst: true })
    .limit(opts.maxAccounts ?? 6);
  return syncAll((data ?? []) as Row[]);
}
