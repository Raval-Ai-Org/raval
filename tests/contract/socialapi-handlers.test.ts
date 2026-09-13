// SocialAPI.ai distribution handlers against a scripted provider and an
// in-memory database: tenant-scoped accounts, OAuth state binding, publish /
// schedule / cancel / retry, quota, duplicate safety and metrics.
import { describe, expect, it, vi } from "vitest";
import {
  cancelHandler,
  completeConnectHandler,
  hashState,
  listAccountsHandler,
  publishHandler,
  retryHandler,
  scheduleHandler,
  selectPendingHandler,
  startConnectHandler,
  syncPostMetrics,
  type PostQuota,
  type SocialApiDeps,
} from "@/lib/socialapi/handlers";
import { SocialApiError } from "@/lib/socialapi/client.server";
import { createMemoryDb, scriptedApi, type ApiRequest } from "../fixtures/memory-supabase";

const WS = "ws-1";
const USER = "user-1";
const BRAND = "brand-1";

const ACCOUNTS = [
  {
    id: "acc_li",
    platform: "linkedin",
    name: "Brand",
    username: "brand",
    brand_id: BRAND,
    status: "active",
  },
  {
    id: "acc_ig",
    platform: "instagram",
    name: "Brand IG",
    username: "brand.ig",
    brand_id: BRAND,
    status: "active",
  },
  {
    id: "acc_tt",
    platform: "tiktok",
    name: "Brand TT",
    username: "brandtt",
    brand_id: BRAND,
    status: "active",
  },
  // Another tenant's account leaking into the response must never be used.
  {
    id: "acc_other",
    platform: "linkedin",
    name: "Other",
    username: "other",
    brand_id: "brand-2",
    status: "active",
  },
  {
    id: "acc_gbp",
    platform: "google",
    name: "Local",
    username: "",
    brand_id: BRAND,
    status: "active",
  },
];

function item(over: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    workspace_id: WS,
    title: "Launch",
    body: "We launched.",
    media_url: null,
    status: "approved",
    scheduled_at: null,
    meta: { platform: "linkedin" },
    ...over,
  };
}

type Script = (req: ApiRequest, key: string) => { status: number; data?: any } | undefined;

function setup(
  opts: {
    items?: any[];
    script?: Script;
    quota?: PostQuota;
    seed?: Record<string, any[]>;
    storage?: Record<string, Blob>;
  } = {},
) {
  const db = createMemoryDb(
    { content_items: opts.items ?? [item()], ...(opts.seed ?? {}) },
    {
      unique: {
        social_oauth_states: [["state_hash"]],
        content_publications: [["content_item_id", "sdr_target_id"]],
      },
      storage: opts.storage,
    },
  );
  const provider = scriptedApi((req, key) => {
    const custom = opts.script?.(req, key);
    if (custom) return custom;
    if (key === "GET /accounts")
      return { status: 200, data: { data: ACCOUNTS, count: ACCOUNTS.length } };
    if (key === "POST /posts/validate")
      return { status: 200, data: { valid: true, errors: [], warnings: [] } };
    throw new Error(`unscripted provider call: ${key}`);
  });
  const deps: SocialApiDeps = { api: provider.api, db, brandId: BRAND, quota: opts.quota };
  return { db, provider, deps };
}

describe("accounts", () => {
  it("lists only this workspace's brand accounts on publishable platforms and mirrors them", async () => {
    const { deps, db, provider } = setup();
    const out = await listAccountsHandler(WS, deps);
    expect(out.status).toBe(200);
    expect(out.body.map((a: any) => a.accountId).sort()).toEqual(["acc_ig", "acc_li", "acc_tt"]);
    expect(provider.calls[0].query).toEqual({ brand_id: BRAND });
    expect(
      db
        .rows("social_accounts")
        .map((r) => r.provider_account_id)
        .sort(),
    ).toEqual(["acc_ig", "acc_li", "acc_tt"]);
    expect(db.rows("social_accounts").every((r) => r.workspace_id === WS)).toBe(true);
  });

  it("marks mirrored accounts the provider no longer lists as disconnected", async () => {
    const { deps, db } = setup({
      seed: {
        social_accounts: [
          {
            id: "m1",
            workspace_id: WS,
            provider: "socialapi",
            provider_account_id: "acc_gone",
            platform: "linkedin",
            status: "active",
          },
        ],
      },
    });
    await listAccountsHandler(WS, deps);
    expect(
      db.rows("social_accounts").find((r) => r.provider_account_id === "acc_gone")?.status,
    ).toBe("disconnected");
  });
});

describe("connect", () => {
  const connectScript: Script = (_req, key) => {
    if (key === "POST /accounts/connect") {
      return {
        status: 202,
        data: {
          auth_url: "https://www.linkedin.com/oauth/v2/authorization?x=1",
          state: "internal",
        },
      };
    }
    return undefined;
  };

  async function started() {
    const ctx = setup({ script: connectScript });
    const out = await startConnectHandler(
      {
        workspaceId: WS,
        userId: USER,
        platform: "linkedin",
        redirectUri: "https://app.test/app/social/connected",
      },
      ctx.deps,
    );
    const body = ctx.provider.find("POST /accounts/connect")[0].body;
    return { ...ctx, out, state: body.state as string, body };
  }

  it("starts with a one-time state stored only as a hash, scoped to the workspace brand", async () => {
    const { out, db, state, body } = await started();
    expect(out).toMatchObject({
      status: 200,
      body: { authorizationUrl: expect.stringMatching(/^https:\/\/www\.linkedin\.com/) },
    });
    expect(body).toMatchObject({
      platform: "linkedin",
      brand_id: BRAND,
      redirect_uri: "https://app.test/app/social/connected",
    });
    const [row] = db.rows("social_oauth_states");
    expect(row.state_hash).toBe(hashState(state));
    expect(JSON.stringify(db.rows("social_oauth_states"))).not.toContain(state);
  });

  it("rejects platforms the provider can't publish to", async () => {
    const { deps } = setup();
    const out = await startConnectHandler(
      { workspaceId: WS, userId: USER, platform: "myspace", redirectUri: "https://x" },
      deps,
    );
    expect(out.status).toBe(400);
  });

  it("refuses a non-https authorization URL from the provider", async () => {
    const { deps } = setup({
      script: (_r, key) =>
        key === "POST /accounts/connect"
          ? { status: 202, data: { auth_url: "javascript:alert(1)" } }
          : undefined,
    });
    const out = await startConnectHandler(
      { workspaceId: WS, userId: USER, platform: "linkedin", redirectUri: "https://x" },
      deps,
    );
    expect(out.status).toBe(502);
  });

  it("binds the result to the starting user and workspace, and is single-use", async () => {
    const { deps, state } = await started();
    const args = { workspaceId: WS, userId: USER, state, status: "success", accountId: "acc_li" };

    expect((await completeConnectHandler({ ...args, userId: "intruder" }, deps)).status).toBe(403);
    expect((await completeConnectHandler({ ...args, workspaceId: "ws-2" }, deps)).status).toBe(403);

    const ok = await completeConnectHandler(args, deps);
    expect(ok).toMatchObject({ status: 200, body: { status: "connected", accountId: "acc_li" } });

    expect((await completeConnectHandler(args, deps)).status).toBe(409);
  });

  it("won't attach an account that isn't under this workspace's brand", async () => {
    const { deps, state } = await started();
    const out = await completeConnectHandler(
      { workspaceId: WS, userId: USER, state, status: "success", accountId: "acc_other" },
      deps,
    );
    expect(out.status).toBe(404);
  });

  it("returns Facebook Page choices without leaking other brands' names, then connects the selection", async () => {
    const ctx = setup({
      script: (req, key) => {
        if (key === "POST /accounts/connect")
          return { status: 202, data: { auth_url: "https://www.facebook.com/dialog/oauth" } };
        if (key === "GET /accounts/pending/pc_1") {
          return {
            status: 200,
            data: {
              platform: "facebook",
              pages: [
                { platform_page_id: "111", name: "Acme Bakery", assignable: true },
                {
                  platform_page_id: "222",
                  name: "Acme Cafe",
                  assignable: false,
                  assigned_brand_name: "Another Tenant Inc",
                },
              ],
              lost_access: [
                { platform_page_id: "333", name: "Old Page", brand_name: "Secret Client LLC" },
              ],
            },
          };
        }
        if (key === "POST /accounts/pending/pc_1/select") {
          expect(req.body).toEqual({ page_ids: ["111"] });
          return { status: 201, data: { account_id: "acc_fb", platform: "facebook" } };
        }
        return undefined;
      },
    });
    await startConnectHandler(
      { workspaceId: WS, userId: USER, platform: "facebook", redirectUri: "https://x" },
      ctx.deps,
    );
    const state = ctx.provider.find("POST /accounts/connect")[0].body.state;

    const pending = await completeConnectHandler(
      { workspaceId: WS, userId: USER, state, status: "selection_required", connectionId: "pc_1" },
      ctx.deps,
    );
    expect(pending.body).toMatchObject({
      status: "selection_required",
      connectionId: "pc_1",
      lostAccess: ["Old Page"],
    });
    expect(JSON.stringify(pending.body)).not.toMatch(/Another Tenant|Secret Client/);

    expect(
      (
        await selectPendingHandler(
          { workspaceId: WS, userId: "intruder", connectionId: "pc_1", pageIds: ["111"] },
          ctx.deps,
        )
      ).status,
    ).toBe(404);
    const selected = await selectPendingHandler(
      { workspaceId: WS, userId: USER, connectionId: "pc_1", pageIds: ["111"] },
      ctx.deps,
    );
    expect(selected).toMatchObject({
      status: 200,
      body: { status: "connected", accountId: "acc_fb" },
    });
  });
});

describe("publish", () => {
  const createdPost = (
    status: string,
    targetStatus: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id: "post-1",
    status,
    text: "We launched.",
    retry_count: 0,
    targets: [{ account_id: "acc_li", platform: "linkedin", status: targetStatus, ...extra }],
  });

  it("publishes to the brand's accounts only, records deliveries, credits and status", async () => {
    const record = vi.fn(async () => undefined);
    const { deps, db, provider } = setup({
      quota: { check: async () => ({ ok: true, used: 1, limit: 60 }), record },
      script: (req, key) => {
        if (key === "POST /posts") {
          return {
            status: 201,
            data: createdPost("published", "published", {
              platform_post_id: "urn:1",
              permalink: "https://www.linkedin.com/feed/update/urn:1",
            }),
          };
        }
        return undefined;
      },
    });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.body.results[0]).toMatchObject({
      contentItemId: "item-1",
      status: "publishing",
      providerPostId: "post-1",
    });

    const [create] = provider.find("POST /posts");
    expect(create.body).toMatchObject({
      text: "We launched.",
      publish_now: true,
      targets: [{ account_id: "acc_li" }],
    });
    expect(create.retry).toBeFalsy();

    expect(db.rows("content_publications")[0]).toMatchObject({
      provider: "socialapi",
      sdr_post_id: "post-1",
      sdr_target_id: "acc_li",
      status: "published",
      platform_post_url: "https://www.linkedin.com/feed/update/urn:1",
    });
    expect(db.rows("content_items")[0]).toMatchObject({
      status: "published",
      meta: {
        platform: "linkedin",
        socialapi_post_id: "post-1",
        distribution_provider: "socialapi",
      },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, operation: "publish", providerPostId: "post-1" }),
    );
  });

  it("refuses unapproved content and content from another workspace", async () => {
    const pending = setup({ items: [item({ status: "pending" })] });
    expect(
      (
        await publishHandler(
          { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
          pending.deps,
        )
      ).status,
    ).toBe(403);

    const foreign = setup({ items: [item({ workspace_id: "ws-2" })] });
    expect(
      (
        await publishHandler(
          { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
          foreign.deps,
        )
      ).status,
    ).toBe(404);
    expect(foreign.provider.find("POST /posts")).toHaveLength(0);
  });

  it("stops at the plan's publishing credit limit without contacting the provider", async () => {
    const { deps, provider, db } = setup({
      quota: { check: async () => ({ ok: false, used: 60, limit: 60 }), record: vi.fn() },
    });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.status).toBe(429);
    expect(out.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(provider.find("POST /posts")).toHaveLength(0);
    expect(db.rows("content_items")[0].status).toBe("approved");
  });

  it("skips (without claiming the item) when the provider's validation fails", async () => {
    const { deps, db, provider } = setup({
      items: [item({ meta: { platform: "instagram" } })],
      script: (_r, key) =>
        key === "POST /posts/validate"
          ? {
              status: 200,
              data: {
                valid: false,
                errors: [{ platform: "instagram", message: "media is required" }],
              },
            }
          : undefined,
    });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.body.results[0]).toMatchObject({
      status: "skipped",
      reason: "Instagram: media is required",
    });
    expect(provider.find("POST /posts")).toHaveLength(0);
    expect(db.rows("content_items")[0].status).toBe("approved");
  });

  it("requires an explicit TikTok audience (no default)", async () => {
    const { deps, provider } = setup({ items: [item({ meta: { platform: "tiktok" } })] });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.body.results[0].status).toBe("skipped");
    expect(provider.find("POST /posts/validate")).toHaveLength(0);
  });

  it("passes the chosen TikTok audience as platform_data", async () => {
    const { deps, provider } = setup({
      items: [item({ meta: { platform: "tiktok" } })],
      script: (_r, key) =>
        key === "POST /posts"
          ? {
              status: 201,
              data: {
                ...createdPost("publishing", "pending"),
                targets: [{ account_id: "acc_tt", status: "pending" }],
              },
            }
          : undefined,
    });
    await publishHandler(
      {
        workspaceId: WS,
        userId: USER,
        contentItemIds: ["item-1"],
        selection: { type: "all" },
        tiktokPrivacyLevel: "SELF_ONLY",
      },
      deps,
    );
    expect(provider.find("POST /posts")[0].body.platform_data).toEqual({
      tiktok: { privacy_level: "SELF_ONLY" },
    });
  });

  it("recovers a post the provider accepted before a timeout instead of duplicating it", async () => {
    const { deps, db, provider } = setup({
      script: (_r, key) => {
        if (key === "POST /posts") throw new SocialApiError("timeout", "timed out");
        if (key === "GET /posts")
          return { status: 200, data: { data: [createdPost("publishing", "publishing")] } };
        return undefined;
      },
    });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.body.results[0]).toMatchObject({ status: "publishing", providerPostId: "post-1" });
    expect(provider.find("POST /posts")).toHaveLength(1);
    expect(db.rows("content_publications")).toHaveLength(1);
  });

  it("marks the item failed (never 'published') when the provider is unreachable and nothing was created", async () => {
    const { deps, db } = setup({
      script: (_r, key) => {
        if (key === "POST /posts")
          throw new SocialApiError("network", "SocialAPI could not be reached");
        if (key === "GET /posts") return { status: 200, data: { data: [] } };
        return undefined;
      },
    });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.status).toBe(503);
    expect(out.body.error.code).toBe("DISTRIBUTION_UNAVAILABLE");
    expect(db.rows("content_items")[0].status).toBe("failed");
    expect(db.rows("content_publications")).toHaveLength(0);
  });

  it("a second concurrent send loses the claim and does not create a second post", async () => {
    const { deps, db, provider } = setup({
      script: (_r, key) => {
        if (key === "POST /posts/validate") {
          // Another request claims the item between validation and our claim.
          db.rows("content_items")[0].status = "publishing";
          return { status: 200, data: { valid: true } };
        }
        return undefined;
      },
    });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.body.results[0].status).toBe("skipped");
    expect(provider.find("POST /posts")).toHaveLength(0);
  });
});

describe("schedule, cancel, retry", () => {
  it("schedules with stored media copied into the provider library", async () => {
    const at = new Date(Date.now() + 2 * 3600_000).toISOString();
    const { deps, db, provider } = setup({
      items: [item({ meta: { platform: "instagram", asset_storage_path: "ws-1/post.png" } })],
      storage: { "ws-1/post.png": new Blob(["png"], { type: "image/png" }) },
      script: (_r, key) => {
        if (key === "POST /media/upload") return { status: 201, data: { media_id: "media-1" } };
        if (key === "POST /posts") {
          return {
            status: 201,
            data: {
              id: "post-9",
              status: "scheduled",
              scheduled_at: at,
              targets: [{ account_id: "acc_ig", status: "pending" }],
            },
          };
        }
        return undefined;
      },
    });
    const out = await scheduleHandler(
      {
        workspaceId: WS,
        userId: USER,
        items: [{ contentItemId: "item-1", scheduledAt: at }],
        selection: { type: "all" },
      },
      deps,
    );
    expect(out.body.results[0]).toMatchObject({ status: "publishing", scheduledAt: at });
    const [create] = provider.find("POST /posts");
    expect(create.body).toMatchObject({
      scheduled_at: at,
      media: [{ source_type: "media_id", source: "media-1" }],
    });
    expect(create.body.publish_now).toBeUndefined();
    expect(db.rows("content_items")[0]).toMatchObject({ status: "scheduled", scheduled_at: at });
    expect(db.rows("content_publications")[0].status).toBe("pending");
  });

  it("rejects schedule times in the past", async () => {
    const { deps, provider } = setup();
    const out = await scheduleHandler(
      {
        workspaceId: WS,
        userId: USER,
        items: [{ contentItemId: "item-1", scheduledAt: "2020-01-01T00:00:00Z" }],
        selection: { type: "all" },
      },
      deps,
    );
    expect(out.body.results[0].status).toBe("skipped");
    expect(provider.calls.filter((c) => c.path === "/posts")).toHaveLength(0);
  });

  it("cancels a scheduled post at the provider and returns the item to approved", async () => {
    const { deps, db, provider } = setup({
      items: [
        item({ status: "scheduled", meta: { platform: "linkedin", socialapi_post_id: "post-9" } }),
      ],
      seed: {
        content_publications: [
          {
            id: "p1",
            workspace_id: WS,
            content_item_id: "item-1",
            provider: "socialapi",
            sdr_post_id: "post-9",
            sdr_target_id: "acc_li",
            status: "pending",
          },
        ],
      },
      script: (_r, key) =>
        key === "DELETE /posts/post-9"
          ? { status: 200, data: { success: true, deleted: true, results: [] } }
          : undefined,
    });
    const out = await cancelHandler({ workspaceId: WS, contentItemId: "item-1" }, deps);
    expect(out.status).toBe(204);
    expect(provider.find("DELETE /posts/post-9")).toHaveLength(1);
    expect(db.rows("content_publications")[0].status).toBe("cancelled");
    expect(db.rows("content_items")[0].status).toBe("approved");
    expect(db.rows("content_items")[0].meta.socialapi_post_id).toBeUndefined();
  });

  it("won't 'cancel' a published post (which would delete it from the platforms)", async () => {
    const { deps, provider } = setup({
      items: [
        item({ status: "published", meta: { platform: "linkedin", socialapi_post_id: "post-9" } }),
      ],
    });
    expect((await cancelHandler({ workspaceId: WS, contentItemId: "item-1" }, deps)).status).toBe(
      400,
    );
    expect(provider.calls).toHaveLength(0);
  });

  it("retries a failed post and moves it back to publishing", async () => {
    const record = vi.fn(async () => undefined);
    const { deps, db, provider } = setup({
      items: [
        item({ status: "failed", meta: { platform: "linkedin", socialapi_post_id: "post-9" } }),
      ],
      quota: { check: async () => ({ ok: true, used: 0, limit: 60 }), record },
      seed: {
        content_publications: [
          {
            id: "p1",
            workspace_id: WS,
            content_item_id: "item-1",
            provider: "socialapi",
            sdr_post_id: "post-9",
            sdr_target_id: "acc_li",
            status: "failed",
            last_error: "rate limited",
          },
        ],
      },
      script: (_r, key) =>
        key === "POST /posts/post-9/retry" ? { status: 200, data: { success: true } } : undefined,
    });
    const out = await retryHandler(
      { workspaceId: WS, userId: USER, contentItemId: "item-1" },
      deps,
    );
    expect(out.status).toBe(200);
    expect(provider.find("POST /posts/post-9/retry")[0].retry).toBeFalsy();
    expect(db.rows("content_publications")[0]).toMatchObject({
      status: "publishing",
      last_error: null,
    });
    expect(db.rows("content_items")[0].status).toBe("publishing");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ operation: "retry" }));
  });
});

describe("metrics", () => {
  it("stores per-destination engagement and rolls it up on the content item", async () => {
    const { deps, db } = setup({
      items: [item({ status: "published" })],
      seed: {
        content_publications: [
          {
            id: "p1",
            workspace_id: WS,
            content_item_id: "item-1",
            provider: "socialapi",
            sdr_post_id: "post-1",
            sdr_target_id: "acc_li",
            status: "published",
          },
          {
            id: "p2",
            workspace_id: WS,
            content_item_id: "item-1",
            provider: "socialapi",
            sdr_post_id: "post-1",
            sdr_target_id: "acc_ig",
            status: "published",
          },
        ],
      },
      script: (_r, key) =>
        key === "GET /posts/post-1/metrics"
          ? {
              status: 200,
              data: {
                data: {
                  post_id: "post-1",
                  targets: [
                    {
                      account_id: "acc_li",
                      metrics: { likes: 10, comments: 2, shares: 1, saves: 0 },
                    },
                    {
                      account_id: "acc_ig",
                      metrics: {
                        likes: 5,
                        comments: 1,
                        shares: 0,
                        saves: 3,
                        extra: { views: 400 },
                      },
                    },
                  ],
                },
              },
            }
          : undefined,
    });
    const out = await syncPostMetrics({ postId: "post-1", workspaceId: WS }, deps);
    expect(out.updated).toBe(2);
    expect(db.rows("content_items")[0].metrics).toMatchObject({
      likes: 15,
      comments: 3,
      shares: 1,
      saves: 3,
      views: 400,
      source: "socialapi",
    });
  });
});
