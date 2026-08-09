// T033 — republish-after-failure (spec FR-023): an item already sent to the SDR
// (has sdr_job_id) republishes with an INCREMENTED sdr_revision → a fresh
// idempotency key → a NEW job, never the old failed result.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { publishContentItemsHandler, type PublishDeps } from "@/lib/sdr.handlers";

describe("republish-after-failure (FR-023)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({ account_id: "tw-1", platform: "twitter", platform_username: "Brand", status: "active" });
  });
  afterAll(async () => await sdr.stop());

  it("bumps sdr_revision so the new attempt gets a fresh idempotency key", async () => {
    const previouslyFailed: MockContentItem = {
      id: "item-1",
      workspace_id: "ws-1",
      body: "edited after failure",
      media_url: null,
      status: "approved",
      meta: { platform: "twitter", sdr_job_id: "job-old-failed", sdr_revision: 0 },
    };
    const db = makeMockContentDb([previouslyFailed]);
    const deps: PublishDeps = { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db };

    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );

    expect(out.status).toBe(200);
    expect(out.body.results[0].status).toBe("publishing");
    // A NEW job id, distinct from the old failed one.
    expect(out.body.results[0].sdrJobId).not.toBe("job-old-failed");

    const req = sdr.getRequests().find((r) => r.path === "/api/v1/publish" && r.method === "POST");
    expect(req?.body.idempotency_key.endsWith(":1")).toBe(true); // revision bumped 0 → 1

    // the new revision is persisted so the next republish bumps again
    const itemUpdate = db._itemUpdates.find((u) => u.id === "item-1");
    expect(itemUpdate?.patch.meta.sdr_revision).toBe(1);
  });

  it("first publish uses revision 0 (no prior job)", async () => {
    sdr.reset(); sdr.addAccount({ account_id: "tw-1", platform: "twitter", platform_username: "Brand", status: "active" });
    const fresh: MockContentItem = { id: "item-2", workspace_id: "ws-1", body: "hi", media_url: null, status: "approved", meta: { platform: "twitter" } };
    const db = makeMockContentDb([fresh]);
    await publishContentItemsHandler({ workspaceId: "ws-1", contentItemIds: ["item-2"], selection: { type: "all" } }, { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db });
    const req = sdr.getRequests().find((r) => r.path === "/api/v1/publish" && r.method === "POST");
    expect(req?.body.idempotency_key.endsWith(":0")).toBe(true);
  });
});
