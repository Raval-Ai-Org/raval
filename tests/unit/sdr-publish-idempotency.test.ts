// T031 — duplicate submission is idempotent (spec FR-006 / SC-003): the same
// item + same selection resubmitted produces ONE job (the SDR returns the
// existing job), never a duplicate post.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { publishContentItemsHandler, type PublishDeps } from "@/lib/sdr.handlers";

describe("publish idempotency (FR-006/SC-003)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({ account_id: "tw-1", platform: "twitter", platform_username: "Brand", status: "active" });
  });
  afterAll(async () => await sdr.stop());

  const item: MockContentItem = { id: "item-1", workspace_id: "ws-1", body: "hi", media_url: null, status: "approved", meta: { platform: "twitter" } };
  const deps = (): PublishDeps => ({ sdrBaseUrl: sdr.baseUrl, token: "ws-key", db: makeMockContentDb([item]) });

  it("re-submitting the same action returns the existing job and does not duplicate", async () => {
    const first = await publishContentItemsHandler({ workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } }, deps());
    expect(first.body.results[0].status).toBe("publishing");

    const second = await publishContentItemsHandler({ workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } }, deps());
    expect(second.body.results[0].status).toBe("already");
    expect(second.body.results[0].sdrJobId).toBe(first.body.results[0].sdrJobId);

    // Two requests hit the SDR, but they carried the SAME idempotency key → one job.
    const publishReqs = sdr.getRequests().filter((r) => r.path === "/api/v1/publish" && r.method === "POST");
    expect(publishReqs).toHaveLength(2);
    expect(publishReqs[0].body.idempotency_key).toBe(publishReqs[1].body.idempotency_key);
    expect(publishReqs[1].body.idempotency_key).toContain("publish:item-1:twitter:");
  });

  it("a different destination selection is a different job (not suppressed)", async () => {
    sdr.reset(); sdr.addAccount({ account_id: "tw-1", platform: "twitter", platform_username: "Brand", status: "active" });
    sdr.addAccount({ account_id: "tw-2", platform: "twitter", platform_username: "Brand2", status: "active" });

    const single = await publishContentItemsHandler({ workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "account", accountId: "tw-1" } }, deps());
    const all = await publishContentItemsHandler({ workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } }, deps());
    expect(single.body.results[0].sdrJobId).not.toBe(all.body.results[0].sdrJobId);
  });
});
