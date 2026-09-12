// Studio drafts are published with an explicit click. The content lifecycle
// forbids draft → publishing, so the handler must record the approval first —
// previously the status update was rejected silently and the item stayed
// `draft` while the SDR job had already been created.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import {
  publishContentItemsHandler,
  scheduleContentItemsHandler,
  type PublishDeps,
} from "@/lib/sdr.handlers";
import { mergeMeta } from "@/lib/content-lifecycle";

describe("distribution lifecycle promotion", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({
      account_id: "li-1",
      platform: "linkedin",
      platform_username: "Brand LI",
      status: "active",
    });
  });
  afterAll(async () => await sdr.stop());

  const item = (status: string, id = `li-${status}`): MockContentItem => ({
    id,
    workspace_id: "ws-1",
    body: "A useful LinkedIn post",
    media_url: null,
    status,
    meta: { platform: "linkedin" },
  });

  it("approves a draft before marking it publishing", async () => {
    const db = makeMockContentDb([item("draft")]);
    const deps: PublishDeps = { sdrBaseUrl: sdr.baseUrl, token: "k", db };
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["li-draft"], selection: { type: "all" } },
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.body.results[0].status).toBe("publishing");
    const statuses = db._itemUpdates.map((u) => u.patch.status);
    expect(statuses).toEqual(["approved", "publishing"]);
  });

  it("re-approves a published item through draft before scheduling", async () => {
    const db = makeMockContentDb([item("published")]);
    const deps: PublishDeps = { sdrBaseUrl: sdr.baseUrl, token: "k", db };
    const when = new Date(Date.now() + 86_400_000).toISOString();
    const out = await scheduleContentItemsHandler(
      {
        workspaceId: "ws-1",
        items: [{ contentItemId: "li-published", scheduledAt: when }],
        selection: { type: "all" },
      },
      deps,
    );
    expect(out.status).toBe(200);
    expect(db._itemUpdates.map((u) => u.patch.status)).toEqual(["draft", "approved", "scheduled"]);
  });

  it("skips items already in flight instead of forcing an illegal transition", async () => {
    const db = makeMockContentDb([item("publishing")]);
    const deps: PublishDeps = { sdrBaseUrl: sdr.baseUrl, token: "k", db };
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["li-publishing"], selection: { type: "all" } },
      deps,
    );
    expect(out.body.results[0].status).toBe("skipped");
    expect(db._itemUpdates).toHaveLength(0);
  });
});

describe("mergeMeta", () => {
  it("keeps unrelated keys and removes keys set to null", () => {
    expect(
      mergeMeta(
        { platform: "instagram", asset_id: "a1", stale: true },
        { asset_id: "a2", stale: null },
      ),
    ).toEqual({ platform: "instagram", asset_id: "a2" });
  });
  it("treats non-object meta as empty", () => {
    expect(mergeMeta(null, { a: 1 })).toEqual({ a: 1 });
  });
});
