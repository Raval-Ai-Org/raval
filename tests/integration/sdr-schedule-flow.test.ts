// T046 — schedule flow integration: schedule → item scheduled + publications
// pending + SDR job queryable (the SDR beat fires later; webhook confirms in US4).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { scheduleContentItemsHandler, type PublishDeps } from "@/lib/sdr.handlers";

describe("schedule flow → delivery mirror (US3 → US4 handoff)", () => {
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

  it("creates a pending SDR job, pending publications, and marks the item scheduled", async () => {
    const item: MockContentItem = {
      id: "item-1",
      workspace_id: "ws-1",
      body: "scheduled",
      media_url: null,
      status: "approved",
      meta: { platform: "linkedin" },
    };
    const db = makeMockContentDb([item]);
    const deps: PublishDeps = { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db };

    const out = await scheduleContentItemsHandler(
      {
        workspaceId: "ws-1",
        items: [
          { contentItemId: "item-1", scheduledAt: new Date(Date.now() + 3600_000).toISOString() },
        ],
        selection: { type: "all" },
      },
      deps,
    );
    expect(out.status).toBe(200);
    const res = out.body.results[0];
    expect(res.status).toBe("publishing");

    // The SDR job is pending (the beat will claim it at scheduled_at).
    const job = sdr.getJob(res.sdrJobId!);
    expect(job?.status).toBe("pending");
    expect(job?.scheduled_at).toBeTruthy();
    expect(job?.targets[0].account_id).toBe("li-1");

    // Mirror rows pending + item scheduled.
    expect(db._publications[0].status).toBe("pending");
    expect(db._itemUpdates.find((u) => u.id === "item-1")?.patch.status).toBe("scheduled");
  });
});
