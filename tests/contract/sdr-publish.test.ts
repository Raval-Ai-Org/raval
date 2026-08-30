// T030 — contract test: publish handler (spec FR-005..007, FR-027, FR-024).
// Exercises publishContentItemsHandler against the MockSDR + mock content DB.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { publishContentItemsHandler, type PublishDeps } from "@/lib/sdr.handlers";

const item = (over: Partial<MockContentItem> = {}): MockContentItem => ({
  id: "item-1",
  workspace_id: "ws-1",
  body: "Hello world",
  media_url: null,
  status: "approved",
  meta: { platform: "twitter" },
  ...over,
});

describe("publishContentItemsHandler", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({
      account_id: "tw-1",
      platform: "twitter",
      platform_username: "Brand",
      status: "active",
    });
    sdr.addAccount({
      account_id: "tw-2",
      platform: "twitter",
      platform_username: "Brand2",
      status: "active",
    });
    sdr.addAccount({
      account_id: "li-1",
      platform: "linkedin",
      platform_username: "Brand LI",
      status: "active",
    });
  });
  afterAll(async () => await sdr.stop());

  const deps = (dbItems: MockContentItem[]): PublishDeps => ({
    sdrBaseUrl: sdr.baseUrl,
    token: "ws-key",
    db: makeMockContentDb(dbItems),
  });

  it("publishes to all active accounts on the item's platform (selection: all)", async () => {
    const depsObj = deps([item()]);
    const db = depsObj.db;
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } },
      depsObj,
    );
    expect(out.status).toBe(200);
    expect(out.body.results[0]).toMatchObject({ contentItemId: "item-1", status: "publishing" });
    // two twitter accounts → two targets
    expect(out.body.results[0].targets).toBe(2);

    // the SDR request body was well-formed
    const publishReq = sdr
      .getRequests()
      .find((r) => r.path === "/api/v1/publish" && r.method === "POST");
    expect(publishReq?.body.idempotency_key).toContain("publish:item-1:twitter:");
    expect(publishReq?.body.targets).toHaveLength(2);
    expect(publishReq?.body.targets[0].content.text).toBe("Hello world");

    // publications upserted (one per target) + item marked publishing
    expect(db._upserts).toHaveLength(2);
    expect(db._publications[0]).toMatchObject({ content_item_id: "item-1", status: "publishing" });
    const itemUpdate = db._itemUpdates.find((u) => u.id === "item-1");
    expect(itemUpdate?.patch.status).toBe("publishing");
    expect(itemUpdate?.patch.meta.sdr_job_id).toBeTruthy();
  });

  it("supports platform and account selections", async () => {
    sdr.reset();
    sdr.addAccount({
      account_id: "tw-1",
      platform: "twitter",
      platform_username: "Brand",
      status: "active",
    });
    sdr.addAccount({
      account_id: "li-1",
      platform: "linkedin",
      platform_username: "Brand LI",
      status: "active",
    });

    const byPlatform = await publishContentItemsHandler(
      {
        workspaceId: "ws-1",
        contentItemIds: ["item-1"],
        selection: { type: "platform", platform: "twitter" },
      },
      deps([item()]),
    );
    expect(byPlatform.status).toBe(200);
    expect(byPlatform.body.results[0].targets).toBe(1);

    // Fresh SDR state so the account selection is not deduped by idempotency.
    sdr.reset();
    sdr.addAccount({
      account_id: "tw-1",
      platform: "twitter",
      platform_username: "Brand",
      status: "active",
    });
    const byAccount = await publishContentItemsHandler(
      {
        workspaceId: "ws-1",
        contentItemIds: ["item-1"],
        selection: { type: "account", accountId: "tw-1" },
      },
      deps([item()]),
    );
    expect(byAccount.status).toBe(200);
    expect(byAccount.body.results[0].targets).toBe(1);
  });

  it("skips an item with no active target accounts for the selection", async () => {
    sdr.reset();
    sdr.addAccount({
      account_id: "tw-1",
      platform: "twitter",
      platform_username: "Brand",
      status: "expired",
    });
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } },
      deps([item()]),
    );
    expect(out.status).toBe(200);
    expect(out.body.results[0].status).toBe("skipped");
  });

  it("rejects a missing content item with 404", async () => {
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["nope"], selection: { type: "all" } },
      deps([item()]),
    );
    expect(out.status).toBe(404);
  });

  it("rejects a pending (AI, unapproved) item with 403 (FR-024 approval gate)", async () => {
    sdr.reset();
    sdr.addAccount({
      account_id: "tw-1",
      platform: "twitter",
      platform_username: "Brand",
      status: "active",
    });
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } },
      deps([item({ status: "pending" })]),
    );
    expect(out.status).toBe(403);
  });

  it("rejects over-limit content with 422 pre-publish (FR-027)", async () => {
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } },
      deps([item({ body: "x".repeat(281) })]),
    );
    expect(out.status).toBe(422);
  });
});
