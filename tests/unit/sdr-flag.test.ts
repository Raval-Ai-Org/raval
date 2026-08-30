// T062 — feature-flag + degraded mode (spec FR-017/SC-007): when the flag is
// OFF, publish/schedule degrade to today's mock (server-side status flip) so the
// platform never regresses and content is never lost.
import { describe, it, expect } from "vitest";
import { isSdrEnabled } from "@/lib/feature-flags";
import { handleSdrDisabled } from "@/lib/sdr.handlers";
import { makeMockDb } from "../fixtures/mock-db";

describe("isSdrEnabled", () => {
  it("defaults to false when unset", () => {
    delete process.env.FEATURE_FLAG_SDR_ENABLED;
    expect(isSdrEnabled()).toBe(false);
  });
  it("is true for 'true' / '1' / 'yes'", () => {
    for (const v of ["true", "1", "yes"]) {
      process.env.FEATURE_FLAG_SDR_ENABLED = v;
      expect(isSdrEnabled()).toBe(true);
    }
  });
  it("is false for '0' / 'false'", () => {
    for (const v of ["0", "false"]) {
      process.env.FEATURE_FLAG_SDR_ENABLED = v;
      expect(isSdrEnabled()).toBe(false);
    }
  });
});

describe("handleSdrDisabled (degraded mock — US5)", () => {
  it("publish degrades to a server-side status flip (published), no SDR involved", async () => {
    const db = makeMockDb({
      content_items: [{ id: "item-1", workspace_id: "ws-1", status: "draft" }],
    });
    const out = await handleSdrDisabled(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], kind: "publish" },
      { db },
    );
    expect(out.status).toBe(200);
    expect(out.body.degraded).toBe(true);
    expect(out.body.results[0]).toEqual({ contentItemId: "item-1", status: "published" });
    expect(db._state.content_items[0].status).toBe("published");
    expect(db._state.content_items[0].scheduled_at).toBeTruthy(); // mirrors the old mock
  });

  it("schedule degrades to scheduled at the requested time", async () => {
    const db = makeMockDb({
      content_items: [{ id: "item-1", workspace_id: "ws-1", status: "draft" }],
    });
    const at = "2026-08-10T09:00:00.000Z";
    const out = await handleSdrDisabled(
      { workspaceId: "ws-1", contentItemIds: ["item-1"], kind: "schedule", scheduledAt: at },
      { db },
    );
    expect(out.body.results[0].status).toBe("scheduled");
    expect(db._state.content_items[0].scheduled_at).toBe(at);
  });
});
