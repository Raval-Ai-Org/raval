// Stories through the Post for Me handlers, against a scripted provider and an
// in-memory database: the `stories` placement, one delivery row per account
// with its frames, a partly posted Story, a retry that resends only the frames
// that failed, Reels placement for videos, and Story numbers.
import { describe, expect, it } from "vitest";
import {
  applyPostSnapshot,
  publishHandler,
  retryHandler,
  scheduleHandler,
  syncPostMetrics,
  type SocialApiDeps,
} from "@/lib/postforme/handlers";
import { reconcilePostForMe } from "@/lib/postforme/reconcile";
import { createMemoryDb, scriptedApi, type ApiRequest } from "../fixtures/memory-supabase";

const WS = "ws-1";
const USER = "user-1";
const P = (n: number) => `workspace/${WS}/assets/story-${n}.jpg`;

const ACCOUNTS = [
  { id: "acc_ig", platform: "instagram", username: "brand.ig", brand_id: WS, status: "active" },
  { id: "acc_fb", platform: "facebook", username: "brand.fb", brand_id: WS, status: "active" },
  { id: "acc_li", platform: "linkedin", username: "brand", brand_id: WS, status: "active" },
];

function story(over: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    workspace_id: WS,
    kind: "story",
    title: "Sour cold brew? One fix.",
    body: "Sour cold brew? One fix.\nSteep it longer.",
    media_url: null,
    status: "approved",
    scheduled_at: null,
    meta: {
      platform: "instagram",
      placement: "stories",
      studio_type: "story",
      story: { mode: "frames", theme: "tip", frames: [], mentions: ["roaster.co"] },
      asset_storage_path: P(0),
      asset_storage_paths: [P(0), P(1), P(2)],
      media_type: "image",
    },
    ...over,
  };
}

type Script = (req: ApiRequest, key: string) => { status: number; data?: any } | undefined;

function setup(
  opts: {
    items?: any[];
    script?: Script;
    seed?: Record<string, any[]>;
    storiesEnabled?: boolean;
  } = {},
) {
  const db = createMemoryDb(
    { content_items: opts.items ?? [story()], ...(opts.seed ?? {}) },
    { unique: { content_publications: [["content_item_id", "sdr_target_id"]] } },
  );
  const provider = scriptedApi((req, key) => {
    const custom = opts.script?.(req, key);
    if (custom) return custom;
    if (key === "GET /accounts") return { status: 200, data: { data: ACCOUNTS } };
    if (key === "POST /posts/validate") return { status: 200, data: { valid: true } };
    throw new Error(`unscripted provider call: ${key}`);
  });
  const deps: SocialApiDeps = {
    api: provider.api,
    db,
    brandId: WS,
    storiesEnabled: opts.storiesEnabled,
    now: () => Date.parse("2026-10-06T10:00:00Z"),
  };
  return { db, provider, deps };
}

const publish = (deps: SocialApiDeps, ids = ["item-1"]) =>
  publishHandler(
    { workspaceId: WS, userId: USER, contentItemIds: ids, selection: { type: "all" } },
    deps,
  );

describe("publishing a Story", () => {
  it("sends every frame, in order, to the stories placement with Instagram tags", async () => {
    const { deps, provider, db } = setup({
      script: (_req, key) =>
        key === "POST /posts"
          ? {
              status: 201,
              data: {
                id: "post_1",
                status: "processing",
                targets: [{ account_id: "acc_ig", status: "publishing" }],
              },
            }
          : undefined,
    });
    const out = await publish(deps);
    expect(out.status).toBe(200);
    expect(out.body.results[0]).toMatchObject({ status: "publishing", providerPostId: "post_1" });

    const body = provider.find("POST /posts")[0].body;
    expect(body.placements).toEqual({ instagram: "stories" });
    expect(body.media).toHaveLength(3);
    expect(body.media.map((m: any) => m.source)).toEqual(
      [0, 1, 2].map((n) => expect.stringContaining(`story-${n}.jpg`)),
    );
    expect(body.media[0].tags).toEqual([{ id: "roaster.co", platform: "instagram", type: "user" }]);
    expect(body.targets).toEqual([{ account_id: "acc_ig" }]);

    const [row] = db.rows("content_publications");
    expect(row).toMatchObject({
      placement: "stories",
      status: "publishing",
      sdr_post_id: "post_1",
    });
    expect(row.frames).toHaveLength(3);
    expect(row.frames.every((f: any) => f.status === "publishing" && f.postId === "post_1")).toBe(
      true,
    );
    expect(db.rows("content_items")[0].status).toBe("publishing");
  });

  it("writes one delivery row per account even when the provider reports one result per frame", async () => {
    const { deps, db } = setup({
      script: (_req, key) =>
        key === "POST /posts"
          ? {
              status: 201,
              data: {
                id: "post_1",
                status: "processed",
                targets: [0, 1, 2].map((frame) => ({
                  account_id: "acc_ig",
                  status: "published",
                  frame,
                  platform_post_id: `ig_${frame}`,
                  permalink: `https://instagram.com/stories/brand/${frame}`,
                })),
              },
            }
          : undefined,
    });
    await publish(deps);
    const rows = db.rows("content_publications");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "published",
      platform_post_id: "ig_0",
      platform_post_url: "https://instagram.com/stories/brand/0",
    });
    expect(db.rows("content_items")[0].status).toBe("published");
  });

  it("asks for account review when a completed provider post has unidentified frames", async () => {
    const { deps, db } = setup({
      script: (_req, key) =>
        key === "POST /posts"
          ? {
              status: 201,
              data: {
                id: "post_unknown",
                status: "published",
                targets: [
                  {
                    account_id: "acc_ig",
                    status: "published",
                    frame: null,
                    platform_post_id: "ig_x",
                  },
                ],
              },
            }
          : undefined,
    });
    await publish(deps);
    await applyPostSnapshot(
      db,
      {
        id: "post_unknown",
        status: "published",
        targets: [
          { account_id: "acc_ig", status: "published", frame: null, platform_post_id: "ig_x" },
        ],
      },
      { now: "2026-10-06T10:01:00.000Z", workspaceId: WS },
    );
    const [row] = db.rows("content_publications");
    expect(row.status).toBe("failed");
    expect(row.last_error).toMatch(/did not identify every Story frame/);
    expect(row.frames.every((frame: { status: string }) => frame.status !== "published")).toBe(
      true,
    );
  });

  it("refuses a Story for a network without Stories instead of posting it to the feed", async () => {
    const { deps, provider } = setup({
      items: [story({ meta: { ...story().meta, platform: "linkedin" } })],
    });
    const out = await publish(deps);
    expect(out.body.results[0]).toMatchObject({
      status: "skipped",
      reason: expect.stringMatching(/no Stories/),
    });
    expect(provider.find("POST /posts")).toHaveLength(0);
  });

  it("refuses a Story with nothing to show, and when Stories are switched off", async () => {
    const empty = setup({
      items: [
        story({ meta: { platform: "instagram", placement: "stories", studio_type: "story" } }),
      ],
    });
    expect((await publish(empty.deps)).body.results[0].reason).toMatch(/no frames/);
    expect(empty.provider.find("POST /posts")).toHaveLength(0);

    const off = setup({ storiesEnabled: false });
    expect((await publish(off.deps)).body.results[0].reason).toMatch(/switched off/);
    expect(off.provider.find("POST /posts")).toHaveLength(0);
  });

  it("does not publish stale artwork when redrawing edited frames fails", async () => {
    const { deps, provider } = setup();
    deps.designedMedia = async () => null;
    const out = await publish(deps);
    expect(out.body.results[0]).toMatchObject({
      status: "skipped",
      reason: expect.stringMatching(/frames could not be updated/i),
    });
    expect(provider.find("POST /posts")).toHaveLength(0);
  });

  it("charges the daily guard for each frame sent to each account", async () => {
    const { deps, provider } = setup();
    let needed = 0;
    deps.quota = {
      check: async (_workspaceId, count) => {
        needed = count;
        return { ok: false, used: 98, limit: 100 };
      },
      record: async () => undefined,
    };
    const out = await publish(deps);
    expect(out.status).toBe(429);
    expect(needed).toBe(3);
    expect(provider.find("POST /posts")).toHaveLength(0);
  });

  it("schedules a Story as pending frames", async () => {
    const blobs: Record<string, Blob> = {};
    for (const n of [0, 1, 2]) blobs[P(n)] = new Blob(["x"], { type: "image/jpeg" });
    const db = createMemoryDb(
      { content_items: [story()] },
      { unique: { content_publications: [["content_item_id", "sdr_target_id"]] }, storage: blobs },
    );
    let n = 0;
    const provider = scriptedApi((_req, key) => {
      if (key === "GET /accounts") return { status: 200, data: { data: ACCOUNTS } };
      if (key === "POST /posts/validate") return { status: 200, data: { valid: true } };
      if (key === "POST /media/upload")
        return { status: 201, data: { media_id: `https://media.pfm/${n++}.jpg` } };
      if (key === "POST /posts")
        return {
          status: 201,
          data: {
            id: "post_s",
            status: "scheduled",
            scheduled_at: "2026-10-07T09:00:00.000Z",
            targets: [{ account_id: "acc_ig", status: "pending" }],
          },
        };
      throw new Error(`unscripted: ${key}`);
    });
    const out = await scheduleHandler(
      {
        workspaceId: WS,
        userId: USER,
        items: [{ contentItemId: "item-1", scheduledAt: "2026-10-07T09:00:00.000Z" }],
        selection: { type: "all" },
      },
      { api: provider.api, db, brandId: WS, now: () => Date.parse("2026-10-06T10:00:00Z") },
    );
    expect(out.status).toBe(200);
    const body = provider.find("POST /posts")[0].body;
    // A scheduled Story's frames are copied to the provider, tags and all.
    expect(body.media.map((m: any) => m.source)).toEqual([
      "https://media.pfm/0.jpg",
      "https://media.pfm/1.jpg",
      "https://media.pfm/2.jpg",
    ]);
    expect(body.media[2].tags).toHaveLength(1);
    expect(body.placements).toEqual({ instagram: "stories" });
    const [row] = db.rows("content_publications");
    expect(row.status).toBe("pending");
    expect(row.frames.every((f: any) => f.status === "pending")).toBe(true);
    expect(db.rows("content_items")[0].status).toBe("scheduled");
  });
});

describe("a video goes to Reels", () => {
  it("sends Instagram and Facebook videos with the reels placement, and others with none", async () => {
    const video = (id: string, platform: string) => ({
      id,
      workspace_id: WS,
      kind: "video",
      title: "Clip",
      body: "Caption",
      media_url: null,
      status: "approved",
      scheduled_at: null,
      meta: {
        platform,
        media_type: "video",
        asset_storage_path: `workspace/${WS}/assets/clip.mp4`,
      },
    });
    const { deps, provider, db } = setup({
      items: [video("v-ig", "instagram"), video("v-li", "linkedin")],
      script: (req, key) =>
        key === "POST /posts"
          ? {
              status: 201,
              data: {
                id: `post_${req.body.targets[0].account_id}`,
                status: "processing",
                targets: [{ account_id: req.body.targets[0].account_id, status: "publishing" }],
              },
            }
          : undefined,
    });
    await publish(deps, ["v-ig", "v-li"]);
    const [ig, li] = provider.find("POST /posts").map((c) => c.body);
    expect(ig.placements).toEqual({ instagram: "reels" });
    expect(li.placements).toBeUndefined();
    expect(db.rows("content_publications").map((r) => r.placement)).toEqual(["reels", "feed"]);
    expect(db.rows("content_publications").every((r) => r.frames === null)).toBe(true);
  });
});

describe("a partly posted Story", () => {
  async function partly() {
    const ctx = setup({
      script: (req, key) => {
        if (key === "POST /posts" && !String(req.body.external_id).includes(":retry:"))
          return {
            status: 201,
            data: {
              id: "post_1",
              status: "processing",
              targets: [{ account_id: "acc_ig", status: "publishing" }],
            },
          };
        if (key === "POST /posts")
          return {
            status: 201,
            data: {
              id: "post_2",
              status: "processing",
              targets: [{ account_id: "acc_ig", status: "publishing" }],
            },
          };
        return undefined;
      },
    });
    await publish(ctx.deps);
    // The provider settles: frames 0 and 2 went out, frame 1 was rejected.
    const touched = await applyPostSnapshot(
      ctx.db,
      {
        id: "post_1",
        status: "processed",
        targets: [
          { account_id: "acc_ig", status: "published", frame: 0, platform_post_id: "ig_0" },
          {
            account_id: "acc_ig",
            status: "failed",
            frame: 1,
            error: { message: "Image too small" },
          },
          { account_id: "acc_ig", status: "published", frame: 2, platform_post_id: "ig_2" },
        ],
      },
      { now: "2026-10-06T10:01:00.000Z", workspaceId: WS },
    );
    expect(touched).toEqual(["item-1"]);
    await ctx.db.from("content_items").update({ status: "failed" }).eq("id", "item-1");
    return ctx;
  }

  it("is marked failed with how many frames went out", async () => {
    const { db } = await partly();
    const [row] = db.rows("content_publications");
    expect(row.status).toBe("failed");
    expect(row.last_error).toMatch(/2 of 3 frames went out; 1 failed\. Image too small/);
    expect(row.frames.map((f: any) => f.status)).toEqual(["published", "failed", "published"]);
  });

  it("retries only the frame that failed, in a new provider post", async () => {
    const { db, deps, provider } = await partly();
    const out = await retryHandler(
      { workspaceId: WS, userId: USER, contentItemId: "item-1" },
      deps,
    );
    expect(out.status).toBe(200);
    const retry = provider.find("POST /posts")[1].body;
    expect(retry.media).toHaveLength(1);
    expect(retry.media[0].source).toContain("story-1.jpg");
    expect(retry.placements).toEqual({ instagram: "stories" });
    expect(retry.targets).toEqual([{ account_id: "acc_ig" }]);

    const [row] = db.rows("content_publications");
    expect(row).toMatchObject({ status: "publishing", sdr_post_id: "post_2" });
    expect(row.frames.map((f: any) => [f.status, f.postId])).toEqual([
      ["published", "post_1"],
      ["publishing", "post_2"],
      ["published", "post_1"],
    ]);

    // The retried frame lands: the whole Story is now out.
    await applyPostSnapshot(
      db,
      {
        id: "post_2",
        status: "processed",
        targets: [
          { account_id: "acc_ig", status: "published", frame: 0, platform_post_id: "ig_1" },
        ],
      },
      { now: "2026-10-06T10:05:00.000Z", workspaceId: WS },
    );
    expect(db.rows("content_publications")[0]).toMatchObject({ status: "published" });
    expect(db.rows("content_publications")[0].frames[1].platformPostId).toBe("ig_1");
  });

  it("won't guess which frames are missing once the Story has changed", async () => {
    const { db, deps, provider } = await partly();
    const item = db.rows("content_items")[0];
    await db
      .from("content_items")
      .update({ meta: { ...item.meta, asset_storage_paths: [P(0), P(1)] } })
      .eq("id", "item-1");
    const out = await retryHandler(
      { workspaceId: WS, userId: USER, contentItemId: "item-1" },
      deps,
    );
    expect(out.status).toBe(409);
    expect(provider.find("POST /posts")).toHaveLength(1);
  });

  it("does not retry a changed frame even when the sequence length matches", async () => {
    const { db, deps, provider } = await partly();
    const item = db.rows("content_items")[0];
    await db
      .from("content_items")
      .update({ meta: { ...item.meta, asset_storage_paths: [P(0), P(2), P(1)] } })
      .eq("id", "item-1");
    const out = await retryHandler(
      { workspaceId: WS, userId: USER, contentItemId: "item-1" },
      deps,
    );
    expect(out.status).toBe(409);
    expect(provider.find("POST /posts")).toHaveLength(1);
  });
});

describe("Story numbers", () => {
  async function published() {
    const ctx = setup({
      script: (_req, key) => {
        if (key === "POST /posts")
          return {
            status: 201,
            data: {
              id: "post_1",
              status: "processed",
              targets: [0, 1, 2].map((frame) => ({
                account_id: "acc_ig",
                status: "published",
                frame,
                platform_post_id: `ig_${frame}`,
              })),
            },
          };
        if (key === "GET /posts/post_1/metrics")
          return {
            status: 200,
            data: {
              data: {
                targets: [
                  {
                    account_id: "acc_ig",
                    metrics: { likes: 0, comments: 0, shares: 1, saves: 0, extra: { views: 540 } },
                    frames: [
                      { platform_post_id: "ig_0", metrics: { reach: 200, views: 220, replies: 3 } },
                      { platform_post_id: "ig_1", metrics: { reach: 170, views: 180, replies: 0 } },
                      { platform_post_id: "ig_2", metrics: { reach: 120, views: 140, replies: 2 } },
                    ],
                  },
                ],
              },
            },
          };
        return undefined;
      },
    });
    await publish(ctx.deps);
    return ctx;
  }

  it("keeps reach from the widest frame, adds views and replies, and shows who stayed", async () => {
    const { db, deps } = await published();
    expect((await syncPostMetrics({ postId: "post_1", workspaceId: WS }, deps)).updated).toBe(1);
    const [row] = db.rows("content_publications");
    expect(row.metrics).toMatchObject({
      story: true,
      reach: 200,
      views: 540,
      replies: 5,
      hold: 0.6,
    });
    expect(row.metrics.frames).toHaveLength(3);
    expect(db.rows("content_items")[0].metrics).toMatchObject({
      reach: 200,
      views: 540,
      replies: 5,
    });
  });

  it("keeps the last live reading once the network answers with zeros", async () => {
    const { db, deps } = await published();
    await syncPostMetrics({ postId: "post_1", workspaceId: WS }, deps);
    const zeros = {
      ...deps,
      api: scriptedApi(() => ({
        status: 200,
        data: {
          data: {
            targets: [
              {
                account_id: "acc_ig",
                metrics: {},
                frames: [{ platform_post_id: "ig_0", metrics: { reach: 0, views: 0 } }],
              },
            ],
          },
        },
      })).api,
    };
    await syncPostMetrics({ postId: "post_1", workspaceId: WS }, zeros);
    expect(db.rows("content_publications")[0].metrics.reach).toBe(200);
  });

  it("reads a live Story's numbers on the hourly sweep, well before a post's turn", async () => {
    const { db, deps, provider } = await published();
    const row = db.rows("content_publications")[0];
    // Synced 2 hours ago: too recent for a post (6 h), due for a live Story (1 h).
    await db
      .from("content_publications")
      .update({
        delivered_at: "2026-10-06T07:00:00.000Z",
        metrics_synced_at: "2026-10-06T08:00:00.000Z",
      })
      .eq("id", row.id);
    const out = await reconcilePostForMe({ api: deps.api, db, now: deps.now });
    expect(out.metricsUpdated).toBe(1);
    expect(provider.find("GET /posts/post_1/metrics")).toHaveLength(1);
  });
});
