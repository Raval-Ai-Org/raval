// feeds.ts — reads each connected account's feed from Post for Me (every post
// on the account, made in Mellox or not, with the network's own numbers) into
// social_account_posts. This is what Analytics → Social shows, with no Google
// connection needed.
//
// Advanced by the existing sdr-reconcile sweep (a few accounts per run, each
// at most every FEED_EVERY_MS) and by "Refresh" in Analytics; no cron job of
// its own. Written with the service role; members read it through RLS.
import type { SocialApiCall } from "@/lib/socialapi/client.server";
import {
  feedFormat,
  feedThumbnail,
  normalizeFeedMetrics,
  platformFromFeed,
  SOCIAL_METRIC_KEYS,
} from "@/lib/social-insights/normalize";

export const FEED_EVERY_MS = 6 * 3600 * 1000;
/** Posts read per account per sync: enough for a 90-day window and the one before. */
export const FEED_POSTS_PER_ACCOUNT = 120;

type Db = any;

export type FeedAccount = {
  id: string;
  workspace_id: string;
  provider_account_id: string;
  platform: string;
};

export type FeedSyncResult = { accounts: number; posts: number; failed: number };

type FeedEntry = {
  platform?: string;
  platform_post_id?: string;
  platform_url?: string;
  caption?: string;
  media?: unknown;
  metrics?: unknown;
  posted_at?: string;
  social_post_id?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** Read one account's feed and store it. Returns how many posts were stored. */
export async function syncAccountFeed(
  account: FeedAccount,
  deps: { api: SocialApiCall; db: Db; now?: () => number },
): Promise<number> {
  const res = await deps.api<{ data?: FeedEntry[] }>({
    path: `/accounts/${encodeURIComponent(account.provider_account_id)}/feed`,
    query: { limit: FEED_POSTS_PER_ACCOUNT },
  });
  if (res.status !== 200) throw new Error(`feed read failed (${res.status})`);
  const entries = (res.data?.data ?? []).filter(
    (e) => typeof e?.platform_post_id === "string" && e.platform_post_id,
  );
  const now = new Date(deps.now?.() ?? Date.now()).toISOString();

  // Which of these Mellox published: by the network's post id or our provider post id.
  const ids = [...new Set(entries.map((e) => e.platform_post_id as string))];
  const providerIds = [
    ...new Set(entries.map((e) => e.social_post_id).filter((v): v is string => !!v)),
  ];
  const mine = new Map<string, string>();
  const byProvider = new Map<string, string>();
  if (ids.length) {
    const { data } = await deps.db
      .from("content_publications")
      .select("content_item_id, platform_post_id")
      .eq("workspace_id", account.workspace_id)
      .eq("sdr_target_id", account.provider_account_id)
      .in("platform_post_id", ids.slice(0, 200));
    for (const r of (data ?? []) as Array<{ content_item_id: string; platform_post_id: string }>)
      mine.set(r.platform_post_id, r.content_item_id);
  }
  if (providerIds.length) {
    const { data } = await deps.db
      .from("content_publications")
      .select("content_item_id, sdr_post_id")
      .eq("workspace_id", account.workspace_id)
      .eq("sdr_target_id", account.provider_account_id)
      .in("sdr_post_id", providerIds.slice(0, 200));
    for (const r of (data ?? []) as Array<{ content_item_id: string; sdr_post_id: string }>)
      byProvider.set(r.sdr_post_id, r.content_item_id);
  }

  const withNumbers: Record<string, unknown>[] = [];
  const withoutNumbers: Record<string, unknown>[] = [];
  for (const e of entries) {
    const rawPlatform = String(e.platform || account.platform);
    const metrics = normalizeFeedMetrics(rawPlatform, e.metrics);
    const url = typeof e.platform_url === "string" && /^https:\/\//.test(e.platform_url);
    const row = {
      workspace_id: account.workspace_id,
      social_account_id: account.id,
      platform: platformFromFeed(rawPlatform),
      platform_post_id: String(e.platform_post_id).slice(0, 300),
      url: url ? (e.platform_url as string).slice(0, 2000) : null,
      caption: String(e.caption ?? "").slice(0, 600),
      thumbnail_url: feedThumbnail(e.media),
      format: feedFormat(e.media),
      posted_at: typeof e.posted_at === "string" && ISO.test(e.posted_at) ? e.posted_at : null,
      content_item_id:
        mine.get(e.platform_post_id as string) ??
        (e.social_post_id ? byProvider.get(e.social_post_id) : undefined) ??
        null,
      provider_post_id: e.social_post_id ?? null,
      synced_at: now,
    };
    // A read that came back without numbers keeps the last ones stored.
    if (SOCIAL_METRIC_KEYS.some((k) => metrics[k] !== undefined))
      withNumbers.push({ ...row, metrics });
    else withoutNumbers.push(row);
  }
  for (const rows of [withNumbers, withoutNumbers]) {
    if (!rows.length) continue;
    const { error } = await deps.db
      .from("social_account_posts")
      .upsert(rows, { onConflict: "social_account_id,platform_post_id" });
    if (error) throw new Error(error.message);
  }
  await deps.db.from("social_accounts").update({ feed_synced_at: now }).eq("id", account.id);
  return entries.length;
}

/** Every active Post for Me account of one workspace (the "Refresh" button). */
export async function syncWorkspaceFeeds(
  workspaceId: string,
  deps: { api: SocialApiCall; db: Db; now?: () => number },
): Promise<FeedSyncResult> {
  const { data } = await deps.db
    .from("social_accounts")
    .select("id, workspace_id, provider_account_id, platform")
    .eq("workspace_id", workspaceId)
    .eq("provider", "postforme")
    .eq("status", "active");
  return syncAll((data ?? []) as FeedAccount[], () => deps.api, deps);
}

/** The sweep: the accounts read longest ago, each at most every FEED_EVERY_MS. */
export async function syncDueFeeds(deps: {
  apiFor: (workspaceId: string) => SocialApiCall;
  db: Db;
  now?: () => number;
  maxAccounts?: number;
}): Promise<FeedSyncResult> {
  const now = deps.now?.() ?? Date.now();
  const cutoff = new Date(now - FEED_EVERY_MS).toISOString();
  const { data } = await deps.db
    .from("social_accounts")
    .select("id, workspace_id, provider_account_id, platform")
    .eq("provider", "postforme")
    .eq("status", "active")
    .or(`feed_synced_at.is.null,feed_synced_at.lt.${cutoff}`)
    .order("feed_synced_at", { ascending: true, nullsFirst: true })
    .limit(deps.maxAccounts ?? 6);
  return syncAll((data ?? []) as FeedAccount[], deps.apiFor, deps);
}

async function syncAll(
  accounts: FeedAccount[],
  apiFor: (workspaceId: string) => SocialApiCall,
  deps: { db: Db; now?: () => number },
): Promise<FeedSyncResult> {
  let posts = 0;
  let failed = 0;
  for (const account of accounts) {
    try {
      posts += await syncAccountFeed(account, { api: apiFor(account.workspace_id), ...deps });
    } catch (e) {
      failed++;
      console.error(
        "[postforme] feed sync failed",
        account.id,
        e instanceof Error ? e.message : String(e),
      );
      // Try this account again on a later sweep, not on the very next one.
      await deps.db
        .from("social_accounts")
        .update({ feed_synced_at: new Date(deps.now?.() ?? Date.now()).toISOString() })
        .eq("id", account.id);
    }
  }
  return { accounts: accounts.length, posts, failed };
}
