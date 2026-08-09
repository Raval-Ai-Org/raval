// T056 — delivery view integration (US2→US4): after publish → webhook, the
// delivery mirror carries the per-platform live link + status that the Studio
// delivery view renders (FR-010).
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleSdrWebhook } from "@/lib/sdr.webhook";
import { encryptSecret } from "@/lib/sdr-provisioning.server";
import { makeMockDb } from "../fixtures/mock-db";

process.env.SDR_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const SECRET = "ws-secret";
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(`POST|/webhook|${body}`).digest("hex");

describe("delivery view data (webhook → per-platform status + live link)", () => {
  it("publishes a live link + status per platform that the Studio renders", async () => {
    const db = makeMockDb({
      workspace_sdr: [{ workspace_id: "ws-1", webhook_secret: encryptSecret(SECRET) }],
      content_publications: [
        { id: "pub-li", workspace_id: "ws-1", content_item_id: "item-1", sdr_post_id: "job-1", sdr_target_id: "t-li", platform: "linkedin", account_id: "li-1", status: "publishing" },
        { id: "pub-tw", workspace_id: "ws-1", content_item_id: "item-1", sdr_post_id: "job-1", sdr_target_id: "t-tw", platform: "twitter", account_id: "tw-1", status: "publishing" },
      ],
      content_items: [{ id: "item-1", workspace_id: "ws-1", body: "post", media_url: null, status: "publishing", meta: { platform: "linkedin" } }],
    });

    // LinkedIn publishes first with a live link.
    const li = JSON.stringify({ event: "post.published", data: { post_id: "job-1", target_id: "t-li", status: "published", platform_post_url: "https://linkedin.com/posts/1" } });
    await handleSdrWebhook({ rawBody: li, signature: sign(li), eventType: "post.published" }, { db });

    // Twitter still retrying → item is publishing (partial), LinkedIn shows the link.
    const tw = JSON.stringify({ event: "post.retrying", data: { post_id: "job-1", target_id: "t-tw", status: "retrying" } });
    await handleSdrWebhook({ rawBody: tw, signature: sign(tw), eventType: "post.retrying" }, { db });

    const rows = db._state.content_publications;
    expect(rows.find((r) => r.sdr_target_id === "t-li")).toMatchObject({ status: "published", platform_post_url: "https://linkedin.com/posts/1" });
    expect(rows.find((r) => r.sdr_target_id === "t-tw").status).toBe("retrying");
    // Item is not fully published while Twitter retries.
    expect(db._state.content_items[0].status).toBe("publishing");
  });

  it("a partial failure surfaces as partial_failed with the failure reason", async () => {
    const db = makeMockDb({
      workspace_sdr: [{ workspace_id: "ws-1", webhook_secret: encryptSecret(SECRET) }],
      content_publications: [
        { id: "pub-a", workspace_id: "ws-1", content_item_id: "item-1", sdr_post_id: "job-1", sdr_target_id: "t-a", platform: "linkedin", account_id: "li-1", status: "publishing" },
        { id: "pub-b", workspace_id: "ws-1", content_item_id: "item-1", sdr_post_id: "job-1", sdr_target_id: "t-b", platform: "twitter", account_id: "tw-1", status: "publishing" },
      ],
      content_items: [{ id: "item-1", workspace_id: "ws-1", body: "post", media_url: null, status: "publishing", meta: { platform: "linkedin" } }],
    });

    const a = JSON.stringify({ event: "post.published", data: { post_id: "job-1", target_id: "t-a", status: "published", platform_post_url: "https://linkedin.com/posts/9" } });
    await handleSdrWebhook({ rawBody: a, signature: sign(a), eventType: "post.published" }, { db });
    const b = JSON.stringify({ event: "post.failed", data: { post_id: "job-1", target_id: "t-b", status: "failed", error_category: "fatal", last_error: "Duplicate content" } });
    await handleSdrWebhook({ rawBody: b, signature: sign(b), eventType: "post.failed" }, { db });

    expect(db._state.content_items[0].status).toBe("partial_failed"); // never a blanket success
    expect(db._state.content_publications.find((r) => r.sdr_target_id === "t-b").last_error).toBe("Duplicate content");
  });
});
