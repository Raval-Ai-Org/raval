import "server-only";
import PostForMe from "post-for-me";
import type {
  SocialApiCall,
  SocialApiRequest,
  SocialApiResponse,
} from "@/lib/socialapi/client.server";

// The distribution pipeline uses a small provider-neutral post shape. This
// adapter translates it to Post for Me without exposing the project key.
//
// Placements (feed / Reels / Stories) and per-account media go out as Post for
// Me's own `platform_configurations` and `account_configurations`. A Story
// post with several media items becomes one Story per item, reported as one
// result per (account, item); each result is mapped back to its frame by the
// media it carries, so the handlers can track frames individually.
type Json = Record<string, any>;
const platformToPfm = (value: string) => (value === "twitter" ? "x" : value);
const platformFromPfm = (value: string) => (value === "x" ? "twitter" : value);

function mediaUrl(m: any): string {
  return typeof m?.url === "string" ? m.url : "";
}

/** The media an account was sent: its own override, else the post's. */
function mediaForAccount(post: any, accountId: string): any[] {
  const own = (post.account_configurations ?? []).find(
    (c: any) => c?.social_account_id === accountId,
  )?.configuration?.media;
  return Array.isArray(own) && own.length ? own : (post.media ?? []);
}

function placementForAccount(post: any, account: { id: string; platform?: string }): string | null {
  const own = (post.account_configurations ?? []).find(
    (c: any) => c?.social_account_id === account.id,
  )?.configuration?.placement;
  return own ?? post.platform_configurations?.[account.platform ?? ""]?.placement ?? null;
}

/** Which of the account's media items a result is for, or null when unknown. */
function frameOf(result: any, post: any): number | null {
  const sent = mediaForAccount(post, result.social_account_id);
  if (sent.length < 2) return sent.length === 1 ? 0 : null;
  const url = mediaUrl(result.media?.[0]);
  if (!url) return null;
  const matches = sent.flatMap((m: any, index: number) => (mediaUrl(m) === url ? [index] : []));
  return matches.length === 1 ? matches[0] : null;
}

function resultTarget(result: any, post?: any) {
  const errorMessage =
    typeof result.error === "string"
      ? result.error
      : typeof result.error?.message === "string"
        ? result.error.message
        : "Publishing failed";
  return {
    account_id: result.social_account_id,
    status: result.success ? "published" : "failed",
    platform_post_id: result.platform_data?.id ?? null,
    permalink: result.platform_data?.url ?? null,
    error: result.success ? null : { message: errorMessage },
    ...(post ? { frame: frameOf(result, post) } : {}),
  };
}

/** Our placement names to Post for Me's, per platform, in its configuration shape. */
function placementConfigs(body: Json): Json {
  const out: Json = {};
  const placements = body.placements && typeof body.placements === "object" ? body.placements : {};
  for (const [platform, placement] of Object.entries(placements)) {
    if (!["instagram", "facebook", "threads"].includes(platform)) continue;
    if (!["timeline", "reels", "stories"].includes(String(placement))) continue;
    if (platform === "threads" && placement === "stories") continue;
    out[platform] = { placement };
  }
  return out;
}

/** Neutral media → Post for Me media, keeping thumbnails and Instagram tags. */
function toPfmMedia(list: any[]): any[] {
  return list
    .filter((m) => typeof m?.source === "string" && m.source)
    .map((m) => ({
      url: m.source,
      ...(typeof m.thumbnail_url === "string" ? { thumbnail_url: m.thumbnail_url } : {}),
      ...(typeof m.thumbnail_timestamp_ms === "number"
        ? { thumbnail_timestamp_ms: m.thumbnail_timestamp_ms }
        : {}),
      ...(Array.isArray(m.tags) && m.tags.length ? { tags: m.tags } : {}),
    }));
}

export function createPostForMeAdapter(
  workspaceId: string,
  key = process.env.POST_FOR_ME_API_KEY ?? "",
): SocialApiCall {
  if (!key) throw new Error("POST_FOR_ME_API_KEY is not configured");
  const client = new PostForMe({ apiKey: key, maxRetries: 0, timeout: 60_000 });
  const options = { maxRetries: 0 };

  async function resultsFor(post: any) {
    const results: any[] = [];
    for (let offset = 0; offset < 500; offset += 50) {
      const page = await client.socialPostResults.list(
        { post_id: [post.id], limit: 50, offset },
        options,
      );
      results.push(...page.data);
      if (!page.meta.next || page.data.length === 0) break;
    }
    return results.map((r) => resultTarget(r, post));
  }

  async function postShape(post: any) {
    const targets = post.status === "processed" ? await resultsFor(post) : [];
    const accounts = (post.social_accounts ?? []).map((a: any) => ({
      account_id: typeof a === "string" ? a : a.id,
      platform: platformFromPfm(a.platform ?? ""),
      status: post.status === "scheduled" ? "pending" : "publishing",
    }));
    const complete = (post.social_accounts ?? []).every((account: any) => {
      const id = typeof account === "string" ? account : account.id;
      const story = placementForAccount(post, { ...account, id }) === "stories";
      const expected = story ? Math.max(1, mediaForAccount(post, id).length) : 1;
      return targets.filter((target: any) => target.account_id === id).length >= expected;
    });
    const missing = accounts.filter(
      (account: any) => !targets.some((target: any) => target.account_id === account.account_id),
    );
    return {
      id: post.id,
      status:
        post.status === "processed"
          ? !complete
            ? "publishing"
            : targets.some((t: any) => t.status === "failed")
              ? "failed"
              : "published"
          : post.status === "draft"
            ? "draft"
            : post.status === "scheduled"
              ? "scheduled"
              : "publishing",
      text: post.caption,
      scheduled_at: post.scheduled_at,
      targets: targets.length ? [...targets, ...missing] : accounts,
      media_count: Array.isArray(post.media) ? post.media.length : 0,
    };
  }

  /** Everything an update must resend so a reschedule never drops a placement. */
  function keep(current: any): Json {
    return {
      caption: current.caption,
      social_accounts: current.social_accounts.map((a: any) => a.id),
      media: current.media,
      ...(current.platform_configurations
        ? { platform_configurations: current.platform_configurations }
        : {}),
      ...(current.account_configurations?.length
        ? { account_configurations: current.account_configurations }
        : {}),
      ...(current.external_id ? { external_id: current.external_id } : {}),
    };
  }

  async function allAccounts() {
    const accounts: any[] = [];
    for (let offset = 0; ; offset += 50) {
      const page = await client.socialAccounts.list(
        { external_id: [workspaceId], status: ["connected"], limit: 50, offset },
        options,
      );
      accounts.push(...page.data);
      if (!page.meta.next || page.data.length === 0) break;
    }
    return accounts;
  }

  async function metricsFor(postId: string) {
    const post = await client.socialPosts.retrieve(postId, options);
    const targets: any[] = [];
    for (const account of post.social_accounts) {
      try {
        const feed = await client.socialAccountFeeds.list(
          account.id,
          {
            social_post_id: [postId],
            expand: ["metrics"],
            // A Story post is one feed entry per frame.
            limit: 20,
          },
          options,
        );
        const entries = feed.data.filter((item) => item.social_post_id === postId && item.metrics);
        if (!entries.length) continue;
        const sum: Record<string, number> = {};
        const metric = (raw: Record<string, any>, keys: string[]) => {
          const nested = raw.public_metrics ?? raw.organic_metrics ?? raw.lifetime_metrics ?? {};
          for (const key of keys) {
            const value = raw[key] ?? nested[key];
            if (typeof value === "number" && Number.isFinite(value)) return value;
          }
          return 0;
        };
        for (const entry of entries) {
          const raw = entry.metrics as Record<string, any>;
          const add = (name: string, keys: string[]) => {
            sum[name] = (sum[name] ?? 0) + metric(raw, keys);
          };
          add("likes", ["likes", "like_count", "reactions", "reaction", "reactions_like"]);
          add("comments", ["comments", "comment_count"]);
          add("shares", ["shares", "share_count", "reposts", "retweets"]);
          add("saves", ["saves", "save_count", "bookmark_count", "save", "saved"]);
          add("views", [
            "views",
            "view_count",
            "video_views",
            "media_views",
            "impressions",
            "impression",
          ]);
          add("replies", ["replies"]);
          add("navigation", ["navigation"]);
          add("profile_visits", ["profile_visits"]);
          add("follows", ["follows"]);
        }
        targets.push({
          account_id: account.id,
          metrics: {
            likes: sum.likes ?? 0,
            comments: sum.comments ?? 0,
            shares: sum.shares ?? 0,
            saves: sum.saves ?? 0,
            extra: {
              views: sum.views ?? 0,
              replies: sum.replies ?? 0,
              navigation: sum.navigation ?? 0,
              profile_visits: sum.profile_visits ?? 0,
              follows: sum.follows ?? 0,
            },
          },
          // Per frame, by the network's own post id, so a Story's frames can be told apart.
          frames: entries.map((entry) => ({
            platform_post_id: entry.platform_post_id,
            posted_at: entry.posted_at ?? null,
            metrics: entry.metrics,
          })),
        });
      } catch {
        // Some networks do not expose metrics; keep other accounts' data.
      }
    }
    return targets;
  }

  return async function call<T = any>(req: SocialApiRequest): Promise<SocialApiResponse<T>> {
    const method = req.method ?? "GET";
    const path = req.path;
    const body = (req.body ?? {}) as Json;
    const ok = (status: number, data: unknown): SocialApiResponse<T> => ({
      status,
      data: data as T,
      requestId: null,
    });
    try {
      if (path === "/accounts" && method === "GET") {
        const accounts = (await allAccounts()).map((a) => ({
          id: a.id,
          platform: platformFromPfm(a.platform),
          username: a.username,
          name: a.username,
          status: a.status === "connected" ? "active" : "expired",
          profile_picture_url: a.profile_photo_url,
          brand_id: a.external_id,
        }));
        return ok(200, { data: accounts });
      }
      if (path === "/accounts/connect" && method === "POST") {
        const platform = platformToPfm(body.platform);
        const platform_data =
          platform === "linkedin"
            ? { linkedin: { connection_type: "organization" } }
            : platform === "instagram"
              ? { instagram: { connection_type: "instagram" } }
              : undefined;
        const link = await client.socialAccounts.createAuthURL(
          {
            platform,
            external_id: typeof body.external_id === "string" ? body.external_id : workspaceId,
            permissions: ["posts", "feeds"],
            ...(platform_data ? { platform_data: platform_data as any } : {}),
          },
          options,
        );
        return ok(202, { auth_url: link.url });
      }
      const accountId = /^\/accounts\/([^/]+)$/.exec(path)?.[1];
      if (accountId && method === "DELETE") {
        await client.socialAccounts.disconnect(decodeURIComponent(accountId), options);
        return ok(204, null);
      }
      if (path === "/posts/validate" && method === "POST") {
        // Post for Me validates during create; no separate validate endpoint.
        return ok(200, { valid: true });
      }
      if (path === "/media/upload" && method === "POST" && req.form) {
        const file = req.form.get("file");
        if (!(file instanceof Blob)) return ok(400, { error: { message: "Media file missing" } });
        const upload = await client.media.createUploadURL(options);
        const sent = await fetch(upload.upload_url, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!sent.ok) return ok(502, { error: { message: "Media upload failed" } });
        return ok(201, { media_id: upload.media_url });
      }
      if (path === "/media/upload-url" && method === "GET") {
        const upload = await client.media.createUploadURL(options);
        return ok(200, { media_id: upload.media_url, upload_url: upload.upload_url });
      }
      if (/^\/media\/.+\/verify$/.test(path) && method === "POST")
        return ok(200, { verified: true });
      if (path === "/posts" && method === "POST") {
        const media = toPfmMedia(Array.isArray(body.media) ? body.media : []);
        const platformConfigurations: Json = {
          ...placementConfigs(body),
          ...(body.platform_data?.tiktok?.privacy_level
            ? {
                tiktok: {
                  privacy_status:
                    body.platform_data.tiktok.privacy_level === "PUBLIC_TO_EVERYONE"
                      ? "public"
                      : "private",
                },
              }
            : {}),
          ...(body.title ? { youtube: { title: body.title } } : {}),
        };
        // Per-account media (a Story retry sends each account only its failed frames).
        const accountConfigurations = (Array.isArray(body.account_media) ? body.account_media : [])
          .filter((a: any) => typeof a?.account_id === "string" && Array.isArray(a.media))
          .map((a: any) => ({
            social_account_id: a.account_id,
            configuration: { media: toPfmMedia(a.media) },
          }));
        const post = await client.socialPosts.create(
          {
            caption: String(body.text ?? ""),
            social_accounts: (body.targets ?? []).map((t: any) => t.account_id),
            ...(media.length ? { media } : {}),
            ...(body.scheduled_at ? { scheduled_at: body.scheduled_at } : {}),
            external_id:
              typeof body.external_id === "string" && body.external_id.startsWith(`${workspaceId}:`)
                ? body.external_id
                : workspaceId,
            ...(Object.keys(platformConfigurations).length
              ? { platform_configurations: platformConfigurations as any }
              : {}),
            ...(accountConfigurations.length
              ? { account_configurations: accountConfigurations as any }
              : {}),
          },
          options,
        );
        return ok(201, await postShape(post));
      }
      if (path === "/posts" && method === "GET") {
        const accountIds = String(req.query?.account_ids ?? "")
          .split(",")
          .filter(Boolean);
        const exactExternalId = String(req.query?.external_id ?? "");
        const found: any[] = [];
        for (let offset = 0; offset < 250; offset += 50) {
          const list = await client.socialPosts.list(
            {
              ...(accountIds.length ? { social_account_id: accountIds } : {}),
              ...(exactExternalId ? { external_id: [exactExternalId] } : {}),
              limit: 50,
              offset,
            },
            options,
          );
          found.push(...list.data);
          if (!list.meta.next || list.data.length === 0) break;
        }
        const posts = await Promise.all(
          found
            .filter(
              (p) =>
                (p.external_id === workspaceId || p.external_id?.startsWith(`${workspaceId}:`)) &&
                (!exactExternalId || p.external_id === exactExternalId),
            )
            .map(postShape),
        );
        return ok(200, { data: posts });
      }
      const postId = /^\/posts\/([^/]+)$/.exec(path)?.[1];
      if (postId && method === "GET")
        return ok(
          200,
          await postShape(await client.socialPosts.retrieve(decodeURIComponent(postId), options)),
        );
      if (postId && method === "DELETE") {
        await client.socialPosts.delete(decodeURIComponent(postId), options);
        return ok(204, null);
      }
      if (postId && method === "PATCH") {
        const current = await client.socialPosts.retrieve(decodeURIComponent(postId), options);
        const updated = await client.socialPosts.update(
          decodeURIComponent(postId),
          { ...(keep(current) as any), scheduled_at: body.scheduled_at ?? null },
          options,
        );
        return ok(200, await postShape(updated));
      }
      const publishId = /^\/posts\/([^/]+)\/publish$/.exec(path)?.[1];
      if (publishId && method === "POST") {
        const current = await client.socialPosts.retrieve(decodeURIComponent(publishId), options);
        const updated = await client.socialPosts.update(
          decodeURIComponent(publishId),
          { ...(keep(current) as any), scheduled_at: null },
          options,
        );
        return ok(201, await postShape(updated));
      }
      if (/^\/posts\/[^/]+\/retry$/.test(path))
        return ok(501, {
          error: {
            message: "Post for Me does not provide a retry operation. Create a new post instead.",
          },
        });
      const metricsId = /^\/posts\/([^/]+)\/metrics$/.exec(path)?.[1];
      if (metricsId)
        return ok(200, { data: { targets: await metricsFor(decodeURIComponent(metricsId)) } });
      if (/^\/accounts\/[^/]+\/creator-info$/.test(path))
        return ok(200, {
          can_post: true,
          privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
        });
      return ok(501, { error: { message: "Unsupported Post for Me operation" } });
    } catch (error: any) {
      if (typeof error?.status === "number") {
        return ok(error.status, { error: { code: error.name, message: error.message } });
      }
      throw error;
    }
  };
}
