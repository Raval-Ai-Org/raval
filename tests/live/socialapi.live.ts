// Live SocialAPI.ai + Supabase checks (opt-in; see vitest.live.config.ts).
// Exercises the real server path the connect button uses — brand provisioning,
// account listing, connect start, callback state handling — against the real
// database and provider. Creates no posts and no accounts; cleans up states.
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (existsSync(".env")) process.loadEnvFile(".env");

const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const handlers = await import("@/lib/socialapi/handlers");
const { getSocialApiDeps, monthlyPostLimit, monthlyPostUsage } =
  await import("@/lib/socialapi/workspace.server");
const { reconcileSocialApi } = await import("@/lib/socialapi/reconcile");

const db = supabaseAdmin as any;
let workspaceId = "";
let ownerId = "";
let deps: Awaited<ReturnType<typeof getSocialApiDeps>>;
const createdStateHashes: string[] = [];

beforeAll(async () => {
  const { data, error } = await db
    .from("workspaces")
    .select("id, owner_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`no workspace to test with: ${error?.message ?? "empty"}`);
  workspaceId = data.id;
  ownerId = data.owner_id;
  deps = await getSocialApiDeps(workspaceId);
});

afterAll(async () => {
  if (createdStateHashes.length) {
    await db.from("social_oauth_states").delete().in("state_hash", createdStateHashes);
  }
});

describe("SocialAPI.ai live", () => {
  it("provisions (or reuses) this workspace's brand", async () => {
    expect(deps.brandId).toBeTruthy();
    const { data } = await db
      .from("workspace_socialapi")
      .select("brand_id, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    expect(data).toMatchObject({ brand_id: deps.brandId, status: "active" });
    // Idempotent: a second resolution returns the same brand.
    expect((await getSocialApiDeps(workspaceId)).brandId).toBe(deps.brandId);
  });

  it("lists the brand's connected accounts", async () => {
    const out = await handlers.listAccountsHandler(workspaceId, deps);
    expect(out.status).toBe(200);
    expect(Array.isArray(out.body)).toBe(true);
  });

  it.each(["linkedin", "instagram", "facebook", "threads", "tiktok", "youtube"])(
    "starts a %s connection and stores a hashed state",
    async (platform) => {
      const apiCalls: any[] = [];
      const spyDeps = {
        ...deps,
        api: (async (req: any) => {
          const res = await deps.api(req);
          apiCalls.push({ req, res });
          return res;
        }) as typeof deps.api,
      };
      const out = await handlers.startConnectHandler(
        {
          workspaceId,
          userId: ownerId,
          platform,
          redirectUri: "http://localhost:8081/app/social/connected",
        },
        spyDeps,
      );
      const connect = apiCalls.find((c) => c.req.path === "/accounts/connect");
      if (out.status !== 200) {
        throw new Error(
          `${platform}: ${out.status} ${JSON.stringify(out.body)} provider=${JSON.stringify(connect?.res?.data)}`,
        );
      }
      expect(out.body.authorizationUrl).toMatch(/^https:\/\//);
      const hash = handlers.hashState(connect.req.body.state);
      createdStateHashes.push(hash);
      const { data } = await db
        .from("social_oauth_states")
        .select("workspace_id, user_id, platform")
        .eq("state_hash", hash)
        .maybeSingle();
      expect(data).toMatchObject({ workspace_id: workspaceId, user_id: ownerId, platform });
    },
  );

  it("runs the reconcile + metrics sweep against the real database and provider", async () => {
    const out = await reconcileSocialApi({ api: deps.api, db });
    expect(out).toMatchObject({ unreachable: 0 });
    expect(typeof out.swept).toBe("number");
  });

  it("reads the plan's publishing credits from the ledger", async () => {
    const [used, limit] = await Promise.all([
      monthlyPostUsage(workspaceId),
      monthlyPostLimit(workspaceId),
    ]);
    expect(used).toBeGreaterThanOrEqual(0);
    expect(limit).toBeGreaterThan(0);
  });

  it("refuses to disconnect an account outside this workspace's brand", async () => {
    const out = await handlers.disconnectHandler(
      { workspaceId, accountId: "acc_not_in_this_brand" },
      deps,
    );
    expect(out.status).toBe(404);
  });

  it("rejects a forged callback state and consumes a real one exactly once", async () => {
    const forged = await handlers.completeConnectHandler(
      {
        workspaceId,
        userId: ownerId,
        state: "forged-state-value-000000",
        status: "success",
        accountId: "acc_x",
      },
      deps,
    );
    expect(forged.status).toBe(400);

    const apiCalls: any[] = [];
    const out = await handlers.startConnectHandler(
      {
        workspaceId,
        userId: ownerId,
        platform: "linkedin",
        redirectUri: "http://localhost:8081/app/social/connected",
      },
      {
        ...deps,
        api: (async (req: any) => {
          apiCalls.push(req);
          return deps.api(req);
        }) as typeof deps.api,
      },
    );
    expect(out.status).toBe(200);
    const state = apiCalls.find((c) => c.path === "/accounts/connect").body.state;
    createdStateHashes.push(handlers.hashState(state));

    const denied = await handlers.completeConnectHandler(
      { workspaceId, userId: ownerId, state, status: "error", error: "access_denied" },
      deps,
    );
    expect(denied).toMatchObject({ status: 200, body: { status: "error" } });
    const replay = await handlers.completeConnectHandler(
      { workspaceId, userId: ownerId, state, status: "success", accountId: "acc_x" },
      deps,
    );
    expect(replay.status).toBe(409);
  });
});
