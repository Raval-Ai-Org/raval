// Composio-connected accounts inside the Post for Me handlers (ADR-0042):
// they appear in the account list, an item aimed only at them never reaches
// Post for Me, a mixed selection sends to both, and cancel / retry / disconnect
// reach the Composio side.
import { describe, expect, it, vi } from "vitest";
import {
  cancelHandler,
  disconnectHandler,
  listAccountsHandler,
  publishHandler,
  retryHandler,
  scheduleHandler,
  type ComposioHooks,
  type SocialApiDeps,
} from "@/lib/postforme/handlers";
import type { ConnectedAccount } from "@/lib/sdr.handlers";
import { createMemoryDb, scriptedApi } from "../fixtures/memory-supabase";

const WS = "ws-1";
const USER = "user-1";
const IMG = "https://cdn.example.com/beans.jpg";

const PFM_ACCOUNTS = [
  { id: "acc_ig_pfm", platform: "instagram", username: "old.ig", brand_id: WS, status: "active" },
];

const COMPOSIO_IG: ConnectedAccount = {
  accountId: "int-1:17841",
  platform: "instagram",
  platformUsername: "beanco",
  status: "active",
  tokenExpiresAt: null,
  provider: "composio",
};

function item(over: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    workspace_id: WS,
    kind: "post",
    title: null,
    body: "New beans",
    media_url: IMG,
    status: "approved",
    scheduled_at: null,
    meta: { platform: "instagram", media_type: "image" },
    ...over,
  };
}

function setup(opts: { items?: any[]; pfmAccounts?: any[]; hooks?: Partial<ComposioHooks> } = {}) {
  const db = createMemoryDb(
    { content_items: opts.items ?? [item()] },
    { unique: { content_publications: [["content_item_id", "sdr_target_id"]] } },
  );
  const provider = scriptedApi((_req, key) => {
    if (key === "GET /accounts") return { status: 200, data: { data: opts.pfmAccounts ?? [] } };
    if (key === "POST /posts/validate") return { status: 200, data: { valid: true } };
    if (key === "POST /posts")
      return {
        status: 201,
        data: { id: "pfm-post-1", status: "processing", targets: [] },
      };
    throw new Error(`unscripted provider call: ${key}`);
  });
  const deliver = vi.fn(async (a: any) =>
    a.targets.map((t: ConnectedAccount) => ({
      accountId: t.accountId,
      status: a.kind === "schedule" ? "pending" : "published",
      last_error: null,
    })),
  );
  const composio: ComposioHooks = {
    accounts: async () => [COMPOSIO_IG],
    deliver,
    disconnect: vi.fn(async (_ws, id) => id === COMPOSIO_IG.accountId),
    retry: vi.fn(async () => [
      { accountId: COMPOSIO_IG.accountId, status: "published", last_error: null },
    ]),
    cancel: vi.fn(async () => 1),
    hasRows: vi.fn(async () => true),
    ...opts.hooks,
  };
  const deps: SocialApiDeps = {
    api: provider.api,
    db,
    brandId: WS,
    composio,
    now: () => Date.parse("2026-11-03T10:00:00Z"),
  };
  return { db, provider, deps, composio, deliver };
}

async function itemRow(db: any) {
  const { data } = await db.from("content_items").select("*").eq("id", "item-1").maybeSingle();
  return data;
}

describe("Composio accounts in the Post for Me handlers", () => {
  it("lists them next to Post for Me accounts", async () => {
    const { deps } = setup({ pfmAccounts: PFM_ACCOUNTS });
    const out = await listAccountsHandler(WS, deps);
    expect(out.status).toBe(200);
    expect(out.body.map((a: ConnectedAccount) => a.accountId)).toEqual([
      "acc_ig_pfm",
      COMPOSIO_IG.accountId,
    ]);
  });

  it("publishes to a Composio account without touching Post for Me", async () => {
    const { deps, provider, deliver, db } = setup();
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.body.results[0]).toMatchObject({ status: "publishing", targets: 1 });
    expect(provider.calls.map((c: any) => `${c.method ?? "GET"} ${c.path}`)).toEqual([
      "GET /accounts",
    ]);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "publish",
        actingUserId: USER,
        media: { images: [IMG], video: null },
      }),
    );
    const row = await itemRow(db);
    expect(row.status).toBe("published");
    expect(row.meta.distribution_provider).toBe("composio");
  });

  it("parks a scheduled post for Mellox to send", async () => {
    const { deps, deliver, db } = setup();
    const out = await scheduleHandler(
      {
        workspaceId: WS,
        userId: USER,
        items: [{ contentItemId: "item-1", scheduledAt: "2026-11-04T09:00:00Z" }],
        selection: { type: "all" },
      } as any,
      deps,
    );
    expect(out.status).toBe(200);
    expect(deliver.mock.calls[0][0].kind).toBe("schedule");
    const row = await itemRow(db);
    expect(row.status).toBe("scheduled");
    expect(row.scheduled_at).toBe("2026-11-04T09:00:00.000Z");
  });

  it("sends a mixed selection to both providers", async () => {
    const { deps, provider, deliver } = setup({ pfmAccounts: PFM_ACCOUNTS });
    await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(provider.calls.map((c: any) => `${c.method ?? "GET"} ${c.path}`)).toContain(
      "POST /posts",
    );
    const body = provider.find("POST /posts")[0].body as any;
    expect(body.targets).toEqual([{ account_id: "acc_ig_pfm" }]);
    expect(deliver.mock.calls[0][0].targets.map((t: ConnectedAccount) => t.accountId)).toEqual([
      COMPOSIO_IG.accountId,
    ]);
  });

  it("refuses an item that isn't approved", async () => {
    const { deps, deliver } = setup({ items: [item({ status: "pending" })] });
    const out = await publishHandler(
      { workspaceId: WS, userId: USER, contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.status).toBe(403);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("cancels, retries and disconnects on the Composio side", async () => {
    const scheduled = setup({ items: [item({ status: "scheduled" })] });
    expect(
      (await cancelHandler({ workspaceId: WS, contentItemId: "item-1" }, scheduled.deps)).status,
    ).toBe(204);
    expect(scheduled.composio.cancel).toHaveBeenCalled();
    expect((await itemRow(scheduled.db)).status).toBe("approved");

    const failed = setup({ items: [item({ status: "failed" })] });
    const retried = await retryHandler(
      { workspaceId: WS, userId: USER, contentItemId: "item-1" },
      failed.deps,
    );
    expect(retried.status).toBe(200);
    expect(failed.composio.retry).toHaveBeenCalled();

    const gone = setup();
    expect(
      (await disconnectHandler({ workspaceId: WS, accountId: COMPOSIO_IG.accountId }, gone.deps))
        .status,
    ).toBe(204);
    expect(gone.provider.calls).toHaveLength(0);
  });
});
