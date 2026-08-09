// T053 — idempotent apply + terminal-wins (R2c): a replay changes nothing, and
// a stale `retrying` never downgrades a published/failed row.
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleSdrWebhook } from "@/lib/sdr.webhook";
import { encryptSecret } from "@/lib/sdr-provisioning.server";
import { makeMockDb } from "../fixtures/mock-db";

process.env.SDR_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
const SECRET = "ws-secret";
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(`POST|/webhook|${body}`).digest("hex");

function seedWith(pubStatus: string) {
  return makeMockDb({
    workspace_sdr: [{ workspace_id: "ws-1", webhook_secret: encryptSecret(SECRET) }],
    content_publications: [{
      id: "pub-1", workspace_id: "ws-1", content_item_id: "item-1", sdr_post_id: "job-1", sdr_target_id: "target-1",
      platform: "twitter", account_id: "tw-1", status: pubStatus,
    }],
    content_items: [{ id: "item-1", workspace_id: "ws-1", body: "x", media_url: null, status: pubStatus, meta: { platform: "twitter" } }],
  });
}

const bodyFor = (status: string) => JSON.stringify({ event: `post.${status}`, data: { post_id: "job-1", target_id: "target-1", status } });

describe("webhook apply semantics", () => {
  it("a replay of the same published callback is a no-op (idempotent)", async () => {
    const db = seedWith("published");
    const body = bodyFor("published");
    await handleSdrWebhook({ rawBody: body, signature: sign(body), eventType: "post.published" }, { db });
    expect(db._state.content_publications[0].status).toBe("published");
    expect(db._state.content_items[0].status).toBe("published");
  });

  it("a stale retrying callback never downgrades a published row (R2c)", async () => {
    const db = seedWith("published");
    const body = bodyFor("retrying");
    await handleSdrWebhook({ rawBody: body, signature: sign(body), eventType: "post.retrying" }, { db });
    expect(db._state.content_publications[0].status).toBe("published"); // NOT downgraded to retrying
    expect(db._state.content_items[0].status).toBe("published");
  });

  it("a failed callback after a published row does not downgrade it", async () => {
    const db = seedWith("published");
    const body = bodyFor("failed");
    await handleSdrWebhook({ rawBody: body, signature: sign(body), eventType: "post.failed" }, { db });
    expect(db._state.content_publications[0].status).toBe("published");
  });

  it("a retrying callback on a publishing row applies (transient path)", async () => {
    const db = seedWith("publishing");
    const body = bodyFor("retrying");
    await handleSdrWebhook({ rawBody: body, signature: sign(body), eventType: "post.retrying" }, { db });
    expect(db._state.content_publications[0].status).toBe("retrying");
    expect(db._state.content_items[0].status).toBe("publishing");
  });
});
