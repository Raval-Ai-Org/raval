// T063 — graceful failure when the SDR is unreachable (spec FR-015): the publish
// path rejects with SDR_UNREACHABLE and mutates NO state, so the item stays
// editable/retryable and content is never lost (SC-008).
import { describe, it, expect, vi } from "vitest";
import { SdrError } from "@/lib/sdr.server";
import { publishContentItemsHandler, scheduleContentItemsHandler } from "@/lib/sdr.handlers";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";

const item: MockContentItem = { id: "item-1", workspace_id: "ws-1", body: "x", media_url: null, status: "approved", meta: { platform: "twitter" } };
const unreachable = vi.fn(async () => {
  throw new SdrError("SDR_UNREACHABLE", "connection refused");
});

describe("graceful degradation on SDR unreachable (FR-015/SC-008)", () => {
  it("publish rejects with SDR_UNREACHABLE and mutates NO state", async () => {
    const db = makeMockContentDb([item]);
    await expect(
      publishContentItemsHandler(
        { workspaceId: "ws-1", contentItemIds: ["item-1"], selection: { type: "all" } },
        { sdrBaseUrl: "http://127.0.0.1:1", token: "ws-key", callSdrFn: unreachable, db },
      ),
    ).rejects.toThrow(SdrError);
    expect(db._itemUpdates).toHaveLength(0); // item not corrupted / stays retryable
    expect(db._upserts).toHaveLength(0); // no publications created
  });

  it("schedule rejects with SDR_UNREACHABLE and mutates NO state", async () => {
    const db = makeMockContentDb([item]);
    await expect(
      scheduleContentItemsHandler(
        { workspaceId: "ws-1", items: [{ contentItemId: "item-1", scheduledAt: new Date(Date.now() + 3600_000).toISOString() }], selection: { type: "all" } },
        { sdrBaseUrl: "http://127.0.0.1:1", token: "ws-key", callSdrFn: unreachable, db },
      ),
    ).rejects.toThrow(SdrError);
    expect(db._itemUpdates).toHaveLength(0);
    expect(db._upserts).toHaveLength(0);
  });
});
