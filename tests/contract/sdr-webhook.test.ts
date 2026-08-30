// T052 — webhook receiver contract (spec FR-021/SC-009, C1): a valid signature
// is applied; an invalid one → 401 with ZERO state change; oversized → 413.
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleSdrWebhook } from "@/lib/sdr.webhook";
import { encryptSecret } from "@/lib/sdr-provisioning.server";
import { makeMockDb } from "../fixtures/mock-db";

process.env.SDR_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
const SECRET = "ws-webhook-secret";
const sign = (body: string) =>
  "sha256=" + createHmac("sha256", SECRET).update(`POST|/webhook|${body}`).digest("hex");

function seed() {
  return makeMockDb({
    workspace_sdr: [{ workspace_id: "ws-1", webhook_secret: encryptSecret(SECRET) }],
    content_publications: [
      {
        id: "pub-1",
        workspace_id: "ws-1",
        content_item_id: "item-1",
        sdr_post_id: "job-1",
        sdr_target_id: "target-1",
        platform: "twitter",
        account_id: "tw-1",
        status: "publishing",
      },
    ],
    content_items: [
      {
        id: "item-1",
        workspace_id: "ws-1",
        body: "x",
        media_url: null,
        status: "publishing",
        meta: { platform: "twitter" },
      },
    ],
  });
}

const payload = (status: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: `post.${status}`,
    data: { post_id: "job-1", target_id: "target-1", status, ...extra },
  });

describe("handleSdrWebhook", () => {
  it("applies a valid post.published callback and updates publication + item status", async () => {
    const db = seed();
    const body = payload("published", { platform_post_url: "https://x.com/status/1" });
    const out = await handleSdrWebhook(
      { rawBody: body, signature: sign(body), eventType: "post.published" },
      { db },
    );
    expect(out.status).toBe(200);
    expect(db._state.content_publications[0].status).toBe("published");
    expect(db._state.content_publications[0].platform_post_url).toBe("https://x.com/status/1");
    expect(db._state.content_items[0].status).toBe("published");
  });

  it("rejects an invalid signature with 401 and changes NO state (FR-021/SC-009)", async () => {
    const db = seed();
    const body = payload("published");
    const out = await handleSdrWebhook(
      { rawBody: body, signature: "sha256=deadbeef", eventType: "post.published" },
      { db },
    );
    expect(out.status).toBe(401);
    expect(db._state.content_publications[0].status).toBe("publishing");
    expect(db._state.content_items[0].status).toBe("publishing");
    expect(db._mutations).toHaveLength(0);
  });

  it("returns 404 for an unknown delivery (no state change)", async () => {
    const db = makeMockDb({
      workspace_sdr: [{ workspace_id: "ws-1", webhook_secret: encryptSecret(SECRET) }],
    });
    const body = payload("published");
    const out = await handleSdrWebhook(
      { rawBody: body, signature: sign(body), eventType: "post.published" },
      { db },
    );
    expect(out.status).toBe(404);
  });

  it("rejects an oversized body with 413 before verification (C1)", async () => {
    const db = seed();
    const big = payload("published", { pad: "x".repeat(2000) });
    const out = await handleSdrWebhook(
      { rawBody: big, signature: sign(big), eventType: "post.published", maxBodyBytes: 1000 },
      { db },
    );
    expect(out.status).toBe(413);
    expect(db._mutations).toHaveLength(0);
  });
});
