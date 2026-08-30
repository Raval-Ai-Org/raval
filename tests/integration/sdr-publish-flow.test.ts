// T034 — publish flow integration (US2 → US4 handoff): publish creates the
// publications rows + marks the item publishing; the SDR job then transitions
// (the webhook receiver in US4 drives terminal state). This asserts the
// handoff contract between the publish handler and the delivery mirror.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { publishContentItemsHandler, type PublishDeps } from "@/lib/sdr.handlers";

describe("publish flow → delivery mirror (US2 → US4 handoff)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({
      account_id: "li-1",
      platform: "linkedin",
      platform_username: "Brand",
      status: "active",
    });
  });
  afterAll(async () => await sdr.stop());

  it("one job per item, one content_publications row per target, item set to publishing", async () => {
    const item: MockContentItem = {
      id: "item-1",
      workspace_id: "ws-1",
      body: "post",
      media_url: null,
      status: "approved",
      meta: { platform: "linkedin" },
    };
    const db = makeMockContentDb([item]);
    const deps: PublishDeps = { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db };

    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } },
      deps,
    );
    expect(out.status).toBe(200);
    const res = out.body.results[0];
    expect(res.status).toBe("publishing");

    // delivery mirror rows exist with sdr_post_id + sdr_target_id (webhook keying)
    expect(db._publications).toHaveLength(1);
    expect(db._publications[0].sdr_post_id).toBe(res.sdrJobId);
    expect(db._publications[0].sdr_target_id).toBeTruthy();

    // item status flips to publishing; sdr_job_id recorded for reconciliation
    const itemUpdate = db._itemUpdates.find((u) => u.id === "item-1");
    expect(itemUpdate?.patch.status).toBe("publishing");
    expect(itemUpdate?.patch.meta.sdr_job_id).toBe(res.sdrJobId);

    // the SDR job is queryable (reconciliation path: GET /api/v1/jobs/{id})
    const job = sdr.getJob(res.sdrJobId!);
    expect(job).toBeTruthy();
    expect(job?.status).toBe("publishing");
    expect(job?.targets[0].account_id).toBe("li-1");
  });
});
