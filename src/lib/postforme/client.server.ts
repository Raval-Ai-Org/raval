import "server-only";
import PostForMe from "post-for-me";
import type {
  SocialApiCall,
  SocialApiRequest,
  SocialApiResponse,
} from "@/lib/socialapi/client.server";

// The distribution pipeline uses a small provider-neutral post shape. This
// adapter translates it to Post for Me without exposing the project key.
type Json = Record<string, any>;
const platformToPfm = (value: string) => (value === "twitter" ? "x" : value);
const platformFromPfm = (value: string) => (value === "x" ? "twitter" : value);

function resultTarget(result: any) {
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
  };
}

export function createPostForMeAdapter(
  workspaceId: string,
  key = process.env.POST_FOR_ME_API_KEY ?? "",
): SocialApiCall {
  if (!key) throw new Error("POST_FOR_ME_API_KEY is not configured");
  const client = new PostForMe({ apiKey: key, maxRetries: 0, timeout: 60_000 });
  const options = { maxRetries: 0 };

  async function resultsFor(postId: string) {
    const found = await client.socialPostResults.list({ post_id: [postId], limit: 50 }, options);
    return found.data.map(resultTarget);
  }

  async function postShape(post: any) {
    const targets = post.status === "processed" ? await resultsFor(post.id) : [];
    const accounts = (post.social_accounts ?? []).map((a: any) => ({
      account_id: typeof a === "string" ? a : a.id,
      platform: platformFromPfm(a.platform ?? ""),
      status: post.status === "scheduled" ? "pending" : "publishing",
    }));
    return {
      id: post.id,
      status:
        post.status === "processed"
          ? targets.length === 0
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
      targets: targets.length ? targets : accounts,
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
            limit: 10,
          },
          options,
        );
        const entry = feed.data.find((item) => item.social_post_id === postId);
        if (!entry?.metrics) continue;
        const raw = entry.metrics as Record<string, any>;
        const nested = raw.public_metrics ?? raw.organic_metrics ?? raw.lifetime_metrics ?? {};
        const metric = (keys: string[]) => {
          for (const key of keys) {
            const value = raw[key] ?? nested[key];
            if (typeof value === "number" && Number.isFinite(value)) return value;
          }
          return 0;
        };
        targets.push({
          account_id: account.id,
          metrics: {
            likes: metric(["likes", "like_count", "reactions", "reaction"]),
            comments: metric(["comments", "comment_count"]),
            shares: metric(["shares", "share_count", "reposts", "retweets"]),
            saves: metric(["saves", "save_count", "bookmark_count", "save"]),
            extra: {
              views: metric(["views", "view_count", "video_views", "impressions", "impression"]),
            },
          },
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
        const media = Array.isArray(body.media)
          ? body.media.map((m: any) => ({ url: m.source }))
          : [];
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
            ...(body.platform_data?.tiktok?.privacy_level || body.title
              ? {
                  platform_configurations: {
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
                  } as any,
                }
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
          {
            caption: current.caption,
            social_accounts: current.social_accounts.map((a) => a.id),
            media: current.media,
            scheduled_at: body.scheduled_at ?? null,
          },
          options,
        );
        return ok(200, await postShape(updated));
      }
      const publishId = /^\/posts\/([^/]+)\/publish$/.exec(path)?.[1];
      if (publishId && method === "POST") {
        const current = await client.socialPosts.retrieve(decodeURIComponent(publishId), options);
        const updated = await client.socialPosts.update(
          decodeURIComponent(publishId),
          {
            caption: current.caption,
            social_accounts: current.social_accounts.map((a) => a.id),
            media: current.media,
            scheduled_at: null,
          },
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
