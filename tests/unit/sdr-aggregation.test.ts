// T054 — item-status aggregation (FR-010/FR-011) + the aggregation guard
// (R2a): non-SDR items (no content_publications rows) are never touched.
import { describe, it, expect } from "vitest";
import { aggregateItemStatus } from "@/lib/sdr.webhook";

describe("aggregateItemStatus", () => {
  it("all published → published", () => {
    expect(aggregateItemStatus([{ status: "published" }, { status: "published" }])).toBe("published");
  });

  it("mix published + failed → partial_failed (FR-011)", () => {
    expect(aggregateItemStatus([{ status: "published" }, { status: "failed" }])).toBe("partial_failed");
  });

  it("all failed → failed", () => {
    expect(aggregateItemStatus([{ status: "failed" }, { status: "failed" }])).toBe("failed");
  });

  it("any in-flight (publishing/pending/retrying) → publishing", () => {
    expect(aggregateItemStatus([{ status: "published" }, { status: "retrying" }])).toBe("publishing");
    expect(aggregateItemStatus([{ status: "pending" }])).toBe("publishing");
  });

  it("all cancelled → approved (item is back to actionable after cancel)", () => {
    expect(aggregateItemStatus([{ status: "cancelled" }])).toBe("approved");
  });
});

describe("aggregation guard (R2a)", () => {
  it("an item with no content_publications rows is never touched by the receiver", async () => {
    // The receiver 404s before any state change when the delivery row is unknown
    // (covered in T052's unknown-delivery case). Here we assert the guard contract:
    // aggregation only runs on items that HAVE rows (the receiver resolves one).
    const { handleSdrWebhook } = await import("@/lib/sdr.webhook");
    const { encryptSecret } = await import("@/lib/sdr-provisioning.server");
    const { makeMockDb } = await import("../fixtures/mock-db");
    const { createHmac } = await import("node:crypto");
    process.env.SDR_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
    const SECRET = "ws-secret";
    const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(`POST|/webhook|${body}`).digest("hex");
    const db = makeMockDb({
      workspace_sdr: [{ workspace_id: "ws-1", webhook_secret: encryptSecret(SECRET) }],
      content_items: [{ id: "non-social", workspace_id: "ws-1", body: "landing", media_url: null, status: "published", meta: {} }],
    });
    const body = JSON.stringify({ event: "post.published", data: { post_id: "unknown", target_id: "unknown", status: "published" } });
    const out = await handleSdrWebhook({ rawBody: body, signature: sign(body), eventType: "post.published" }, { db });
    expect(out.status).toBe(404); // no delivery row → item untouched
    expect(db._state.content_items[0].status).toBe("published"); // unchanged
  });
});
