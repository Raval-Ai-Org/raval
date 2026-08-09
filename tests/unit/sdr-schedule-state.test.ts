// T045 — schedule state: reschedule = fresh job (revision bump), and a schedule
// that already fired cannot be rescheduled via cancel (cancel-race handled).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { scheduleContentItemsHandler, cancelScheduledHandler } from "@/lib/sdr.handlers";

describe("schedule state (reschedule + cancel-race)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({ account_id: "tw-1", platform: "twitter", platform_username: "Brand", status: "active" });
  });
  afterAll(async () => await sdr.stop());

  const future = () => new Date(Date.now() + 3600_000).toISOString();

  it("rescheduling an already-scheduled item starts a FRESH job (revision bump)", async () => {
    const previouslyScheduled: MockContentItem = {
      id: "item-1", workspace_id: "ws-1", body: "post", media_url: null, status: "scheduled",
      meta: { platform: "twitter", sdr_job_id: "job-old", sdr_revision: 0 },
    };
    const db = makeMockContentDb([previouslyScheduled]);
    const out = await scheduleContentItemsHandler(
      { workspaceId: "ws-1", items: [{ contentItemId: "item-1", scheduledAt: future() }], selection: { type: "all" } },
      { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db },
    );
    expect(out.body.results[0].status).toBe("publishing");
    expect(out.body.results[0].sdrJobId).not.toBe("job-old");
    const req = sdr.getRequests().find((r) => r.path === "/api/v1/schedule" && r.method === "POST");
    expect(req?.body.idempotency_key.endsWith(":1")).toBe(true);
  });

  it("cancel-race: a job that already fired cannot be cancelled (400), item stays scheduled", async () => {
    sdr.addJob({
      job_id: "job-fired", workspace_id: "ws-1", idempotency_key: "schedule:f", status: "published",
      targets: [{ target_id: "t", account_id: "tw-1", platform: "twitter", status: "published" }],
    });
    const fired: MockContentItem = { id: "item-2", workspace_id: "ws-1", body: "p", media_url: null, status: "scheduled", meta: { platform: "twitter", sdr_job_id: "job-fired" } };
    const db = makeMockContentDb([fired]);
    const out = await cancelScheduledHandler({ workspaceId: "ws-1", contentItemId: "item-2" }, { sdrBaseUrl: sdr.baseUrl, token: "ws-key", db });
    expect(out.status).toBe(400);
    // item not reverted to approved (it already fired)
    expect(db._itemUpdates.find((u) => u.id === "item-2")).toBeUndefined();
  });
});
