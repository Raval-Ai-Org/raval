// T042 — contract test: schedule handler (spec FR-008/FR-025). Validates the
// absolute UTC instant + ≤1yr window; SDR request shape.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { scheduleContentItemsHandler, type PublishDeps } from "@/lib/sdr.handlers";

const future = () => new Date(Date.now() + 3600_000).toISOString();

describe("scheduleContentItemsHandler", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({ account_id: "tw-1", platform: "twitter", platform_username: "Brand", status: "active" });
  });
  afterAll(async () => await sdr.stop());

  const item: MockContentItem = { id: "item-1", workspace_id: "ws-1", body: "scheduled post", media_url: null, status: "approved", meta: { platform: "twitter" } };
  const deps = (): PublishDeps => ({ sdrBaseUrl: sdr.baseUrl, token: "ws-key", db: makeMockContentDb([item]) });

  it("schedules an approved item: SDR request has UTC scheduled_at + schedule idempotency key", async () => {
    const depsObj = deps();
    const db = depsObj.db;
    const out = await scheduleContentItemsHandler(
      { workspaceId: "ws-1", items: [{ contentItemId: "item-1", scheduledAt: future() }], selection: { type: "all" } },
      depsObj,
    );
    expect(out.status).toBe(200);
    expect(out.body.results[0]).toMatchObject({ status: "publishing", targets: 1 });

    const req = sdr.getRequests().find((r) => r.path === "/api/v1/schedule" && r.method === "POST");
    expect(req?.body.idempotency_key).toContain("schedule:item-1:twitter:");
    expect(new Date(req?.body.scheduled_at).toISOString()).toBe(req?.body.scheduled_at); // absolute UTC instant

    // item → scheduled + sdr_job_id; publications → pending (SDR beat fires later)
    const itemUpdate = db._itemUpdates.find((u) => u.id === "item-1");
    expect(itemUpdate?.patch.status).toBe("scheduled");
    expect(itemUpdate?.patch.meta.sdr_job_id).toBeTruthy();
    expect(db._publications[0].status).toBe("pending");
  });

  it("skips a past scheduled time", async () => {
    const out = await scheduleContentItemsHandler(
      { workspaceId: "ws-1", items: [{ contentItemId: "item-1", scheduledAt: new Date(Date.now() - 1000).toISOString() }], selection: { type: "all" } },
      deps(),
    );
    expect(out.body.results[0].status).toBe("skipped");
    expect(out.body.results[0].reason).toContain("future");
  });

  it("skips a schedule more than 1 year out (SDR cap)", async () => {
    const out = await scheduleContentItemsHandler(
      { workspaceId: "ws-1", items: [{ contentItemId: "item-1", scheduledAt: new Date(Date.now() + 400 * 24 * 3600_000).toISOString() }], selection: { type: "all" } },
      deps(),
    );
    expect(out.body.results[0].status).toBe("skipped");
    expect(out.body.results[0].reason).toContain("1 year");
  });

  it("rejects a pending (unapproved) item with 403 (FR-024)", async () => {
    const db = makeMockContentDb([{ ...item, status: "pending" }]);
    const out = await scheduleContentItemsHandler(
      { workspaceId: "ws-1", items: [{ contentItemId: "item-1", scheduledAt: future() }], selection: { type: "all" } },
      { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db },
    );
    expect(out.status).toBe(403);
  });
});
