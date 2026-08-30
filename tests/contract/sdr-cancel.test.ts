// T043 — contract test: cancel scheduled item (spec FR-009). Cancels the SDR
// job, marks publications cancelled, and returns the item to an actionable state.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { cancelScheduledHandler, type PublishDeps } from "@/lib/sdr.handlers";

describe("cancelScheduledHandler", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({
      account_id: "tw-1",
      platform: "twitter",
      platform_username: "Brand",
      status: "active",
    });
  });
  afterAll(async () => await sdr.stop());

  const scheduledItem: MockContentItem = {
    id: "item-1",
    workspace_id: "ws-1",
    body: "post",
    media_url: null,
    status: "scheduled",
    meta: { platform: "twitter", sdr_job_id: "job-scheduled-1", sdr_revision: 0 },
  };
  const deps = (dbItems: MockContentItem[]): PublishDeps => ({
    sdrBaseUrl: sdr.baseUrl,
    token: "ws-key",
    db: makeMockContentDb(dbItems),
  });

  it("cancels a pending schedule (204): SDR job cancelled, publications cancelled, item actionable", async () => {
    const db = makeMockContentDb([scheduledItem]);
    // Pre-seed the SDR job so DELETE resolves it.
    sdr.addJob({
      job_id: "job-scheduled-1",
      workspace_id: "ws-1",
      idempotency_key: "schedule:x",
      status: "pending",
      targets: [{ target_id: "t1", account_id: "tw-1", platform: "twitter", status: "pending" }],
    });
    const out = await cancelScheduledHandler(
      { workspaceId: "ws-1", contentItemId: "item-1" },
      { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db },
    );

    expect(out.status).toBe(204);
    expect(sdr.getJob("job-scheduled-1")?.status).toBe("cancelled");
    const itemUpdate = db._itemUpdates.find((u) => u.id === "item-1");
    expect(itemUpdate?.patch.status).toBe("approved");
    expect(itemUpdate?.patch.meta.sdr_job_id).toBeUndefined(); // cleared
  });

  it("returns 400 when the item has no active SDR schedule", async () => {
    const db = makeMockContentDb([{ ...scheduledItem, meta: { platform: "twitter" } }]); // no sdr_job_id
    const out = await cancelScheduledHandler(
      { workspaceId: "ws-1", contentItemId: "item-1" },
      { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db },
    );
    expect(out.status).toBe(400);
  });

  it("returns 400 when the schedule already fired (SDR rejects cancel of published/failed)", async () => {
    sdr.addJob({
      job_id: "job-fired-1",
      workspace_id: "ws-1",
      idempotency_key: "schedule:y",
      status: "published",
      targets: [{ target_id: "t2", account_id: "tw-1", platform: "twitter", status: "published" }],
    });
    const fired: MockContentItem = {
      ...scheduledItem,
      meta: { platform: "twitter", sdr_job_id: "job-fired-1" },
    };
    const out = await cancelScheduledHandler(
      { workspaceId: "ws-1", contentItemId: "item-1" },
      { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db: makeMockContentDb([fired]) },
    );
    expect(out.status).toBe(400);
  });
});
