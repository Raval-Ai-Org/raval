import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../../tests/fixtures/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  calls: [] as Array<{
    tool: string;
    arguments: Record<string, unknown>;
    approvalRef?: string | null;
  }>,
  answer: (_tool: string): unknown => ({ successful: true, data: { id: "x" }, error: null }),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/server/integrations/execute.server", () => ({
  runIntegrationTool: vi.fn(async (args: any) => {
    h.calls.push({ tool: args.tool, arguments: args.arguments, approvalRef: args.approvalRef });
    const out = h.answer(args.tool);
    if (out instanceof Error) throw out;
    return out;
  }),
}));

import { ComposioGatewayError } from "@/server/integrations/composio/gateway.server";
import {
  cancelPending,
  deliver,
  retryFailed,
  runDueComposioPublications,
  syncDestinations,
} from "./service.server";

const WS = "11111111-1111-4111-8111-111111111111";
const ACC = "acc-ig";
const IG_TARGET = `${ACC}:17841`;
const IMG = "https://cdn.example.com/a.jpg";

function seed() {
  h.db = createMemoryDb(
    {
      integration_accounts: [{ id: ACC, workspace_id: WS, app: "instagram", status: "active" }],
      social_accounts: [
        {
          id: "sa1",
          workspace_id: WS,
          provider: "composio",
          provider_account_id: IG_TARGET,
          integration_account_id: ACC,
          platform: "instagram",
          status: "active",
          connected_by: "user-1",
        },
      ],
      content_items: [
        {
          id: "item-1",
          workspace_id: WS,
          status: "scheduled",
          scheduled_at: "2026-11-03T09:00:00.000Z",
          body: "Hello #beans",
          meta: { platform: "instagram" },
        },
      ],
      content_publications: [],
    },
    {
      unique: {
        content_publications: [["content_item_id", "sdr_target_id"]],
        social_accounts: [["provider", "provider_account_id"]],
      },
    },
  );
  h.calls = [];
  h.answer = (tool) =>
    tool === "INSTAGRAM_POST_IG_USER_MEDIA"
      ? { successful: true, data: { data: { id: "container-9" } }, error: null }
      : { successful: true, data: { id: "media-77" }, error: null };
}

const rows = () => (h.db as any).tables?.content_publications ?? read("content_publications");
async function read(table: string) {
  const { data } = await (h.db as any).from(table).select("*");
  return data as any[];
}

const target = {
  accountId: IG_TARGET,
  platform: "instagram",
  platformUsername: "beanco",
  status: "active" as const,
  tokenExpiresAt: null,
  provider: "composio" as const,
};

function args(kind: "publish" | "schedule") {
  return {
    workspaceId: WS,
    actingUserId: "user-1",
    item: { id: "item-1", body: "Hello #beans", meta: {} },
    platform: "instagram",
    placement: "feed" as const,
    targets: [target],
    kind,
    media: { images: [IMG], video: null },
  };
}

beforeEach(seed);

describe("deliver now", () => {
  it("creates the container, publishes it, and records the post", async () => {
    const out = await deliver(args("publish"));
    expect(out).toEqual([{ accountId: IG_TARGET, status: "published", last_error: null }]);
    expect(h.calls.map((c) => c.tool)).toEqual([
      "INSTAGRAM_POST_IG_USER_MEDIA",
      "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
    ]);
    expect(h.calls[0].arguments).toMatchObject({ ig_user_id: "17841", image_url: IMG });
    expect(h.calls[1].arguments.creation_id).toBe("container-9");
    expect(h.calls.every((c) => c.approvalRef === "content:item-1")).toBe(true);
    const [row] = await read("content_publications");
    expect(row).toMatchObject({
      provider: "composio",
      status: "published",
      platform_post_id: "media-77",
      attempt: 1,
    });
  });

  it("records a refusal with the network's reason", async () => {
    h.answer = () => ({ successful: false, data: {}, error: "Media type not supported" });
    const [out] = await deliver(args("publish"));
    expect(out.status).toBe("failed");
    expect(out.last_error).toBe("Media type not supported");
    expect(h.calls).toHaveLength(1);
  });

  it("never resends a publish whose outcome is unknown", async () => {
    h.answer = (tool) =>
      tool === "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH"
        ? new ComposioGatewayError(504, "timeout", "unknown_outcome")
        : { successful: true, data: { id: "c1" }, error: null };
    const [out] = await deliver(args("publish"));
    expect(out.status).toBe("failed");
    const [row] = await read("content_publications");
    expect(row.error_code).toBe("unknown_outcome");
    expect(h.calls.filter((c) => c.tool.endsWith("_PUBLISH"))).toHaveLength(1);
  });

  it("refuses an account that was disconnected", async () => {
    await (h.db as any).from("social_accounts").update({ status: "disconnected" }).eq("id", "sa1");
    const [out] = await deliver(args("publish"));
    expect(out.status).toBe("failed");
    expect(h.calls).toHaveLength(0);
  });

  it("refuses an Instagram Story without calling Composio", async () => {
    const [out] = await deliver({ ...args("publish"), placement: "stories" });
    expect(out.status).toBe("failed");
    expect(h.calls).toHaveLength(0);
  });
});

describe("scheduled posts", () => {
  const deps = (now: string) => ({
    mediaFor: async () => ({ images: [IMG], video: null }),
    recompute: vi.fn(async () => null),
    now: () => Date.parse(now),
  });

  it("parks rows as pending, then sends them once the time comes", async () => {
    expect((await deliver(args("schedule")))[0].status).toBe("pending");
    expect(h.calls).toHaveLength(0);

    const early = await runDueComposioPublications(deps("2026-11-03T08:59:00.000Z"));
    expect(early).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(h.calls).toHaveLength(0);

    const d = deps("2026-11-03T09:00:30.000Z");
    expect(await runDueComposioPublications(d)).toEqual({ sent: 1, failed: 0, cancelled: 0 });
    expect(d.recompute).toHaveBeenCalledWith("item-1");
    const [row] = await read("content_publications");
    expect(row.status).toBe("published");

    // Sent once: a second sweep finds nothing to do.
    expect(await runDueComposioPublications(d)).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(h.calls).toHaveLength(2);
  });

  it("cancels parked rows of an item that is no longer scheduled", async () => {
    await deliver(args("schedule"));
    await (h.db as any).from("content_items").update({ status: "draft" }).eq("id", "item-1");
    const out = await runDueComposioPublications(deps("2026-11-03T10:00:00.000Z"));
    expect(out.cancelled).toBe(1);
    expect(h.calls).toHaveLength(0);
  });

  it("fails a send that was cut off, without resending it", async () => {
    await (h.db as any).from("content_publications").insert({
      workspace_id: WS,
      content_item_id: "item-1",
      provider: "composio",
      sdr_post_id: "composio:item-1",
      sdr_target_id: IG_TARGET,
      account_id: IG_TARGET,
      platform: "instagram",
      status: "publishing",
      updated_at: "2026-11-03T08:00:00.000Z",
    });
    await runDueComposioPublications(deps("2026-11-03T09:00:00.000Z"));
    const [row] = await read("content_publications");
    expect(row).toMatchObject({ status: "failed", error_code: "unknown_outcome" });
    expect(h.calls).toHaveLength(0);
  });

  it("cancelPending cancels only parked rows", async () => {
    await deliver(args("schedule"));
    expect(await cancelPending(WS, "item-1")).toBe(1);
    expect((await read("content_publications"))[0].status).toBe("cancelled");
  });
});

describe("retryFailed", () => {
  it("resends failed rows once, on a person's click", async () => {
    h.answer = () => ({ successful: false, data: {}, error: "busy" });
    await deliver(args("publish"));
    seedAnswers();
    const out = await retryFailed({
      workspaceId: WS,
      actingUserId: "user-1",
      item: { id: "item-1", body: "Hello", meta: {} },
      media: { images: [IMG], video: null },
    });
    expect(out.map((r) => r.status)).toEqual(["published"]);
    expect((await read("content_publications"))[0].attempt).toBe(2);
  });
});

function seedAnswers() {
  h.answer = (tool) =>
    tool === "INSTAGRAM_POST_IG_USER_MEDIA"
      ? { successful: true, data: { id: "c2" }, error: null }
      : { successful: true, data: { id: "m2" }, error: null };
}

describe("syncDestinations", () => {
  it("mirrors each Facebook Page as its own account", async () => {
    h.answer = () => ({
      successful: true,
      data: {
        data: {
          data: [
            { id: "p1", name: "BeanCo" },
            { id: "p2", name: "Cafe" },
          ],
        },
      },
      error: null,
    });
    const n = await syncDestinations({
      workspaceId: WS,
      integrationAccountId: "acc-fb",
      app: "facebook",
      connectedBy: "user-1",
    });
    expect(n).toBe(2);
    const fb = (await read("social_accounts")).filter((r) => r.platform === "facebook");
    expect(fb.map((r) => r.provider_account_id).sort()).toEqual(["acc-fb:p1", "acc-fb:p2"]);
    expect(fb.every((r) => r.provider === "composio" && r.status === "active")).toBe(true);
  });

  it("says plainly when there's nothing to post to", async () => {
    await (h.db as any)
      .from("integration_accounts")
      .insert({ id: "acc-fb", workspace_id: WS, app: "facebook", status: "active" });
    h.answer = () => ({ successful: true, data: { data: [] }, error: null });
    expect(
      await syncDestinations({
        workspaceId: WS,
        integrationAccountId: "acc-fb",
        app: "facebook",
        connectedBy: null,
      }),
    ).toBe(0);
    const [row] = (await read("integration_accounts")).filter((r) => r.id === "acc-fb");
    expect(row.last_error).toMatch(/No Facebook Page/);
  });

  it("skips networks Composio doesn't publish for", async () => {
    expect(
      await syncDestinations({
        workspaceId: WS,
        integrationAccountId: "acc-hs",
        app: "hubspot",
        connectedBy: null,
      }),
    ).toBe(0);
    expect(h.calls).toHaveLength(0);
  });
});

void rows;
