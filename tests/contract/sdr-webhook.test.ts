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
    timestamp: new Date().toISOString(),
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

// F-SEC-001 regression: account.expired used to mutate before verification.
describe("handleSdrWebhook — account.expired and replay protection", () => {
  const OTHER_SECRET = "other-workspace-secret";
  const signWith = (secret: string, body: string) =>
    "sha256=" + createHmac("sha256", secret).update(`POST|/webhook|${body}`).digest("hex");

  function seedTwoWorkspaces() {
    return makeMockDb({
      workspace_sdr: [
        { workspace_id: "ws-1", webhook_secret: encryptSecret(SECRET) },
        { workspace_id: "ws-2", webhook_secret: encryptSecret(OTHER_SECRET) },
      ],
      content_publications: [
        {
          id: "pub-1",
          workspace_id: "ws-1",
          content_item_id: "item-1",
          sdr_post_id: "job-1",
          sdr_target_id: "target-1",
          platform: "twitter",
          account_id: "acct-1",
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
          meta: {},
        },
      ],
    });
  }

  const expired = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      event: "account.expired",
      timestamp: new Date().toISOString(),
      data: { account_id: "acct-1" },
      ...extra,
    });

  it("rejects an UNSIGNED account.expired with 401 and changes no state", async () => {
    const db = seedTwoWorkspaces();
    const out = await handleSdrWebhook(
      { rawBody: expired(), signature: null, eventType: "account.expired" },
      { db },
    );
    expect(out.status).toBe(401);
    expect(db._state.content_publications[0].status).toBe("publishing");
    expect(db._mutations).toHaveLength(0);
  });

  it("rejects account.expired signed with ANOTHER workspace's secret", async () => {
    const db = seedTwoWorkspaces();
    const body = expired();
    const out = await handleSdrWebhook(
      { rawBody: body, signature: signWith(OTHER_SECRET, body), eventType: "account.expired" },
      { db },
    );
    expect(out.status).toBe(401);
    expect(db._mutations).toHaveLength(0);
  });

  it("applies a verified account.expired, scoped to the workspace, and recomputes the item", async () => {
    const db = seedTwoWorkspaces();
    const body = expired();
    const out = await handleSdrWebhook(
      { rawBody: body, signature: sign(body), eventType: "account.expired" },
      { db },
    );
    expect(out.status).toBe(200);
    expect(db._state.content_publications[0].status).toBe("failed");
    expect(db._state.content_publications[0].error_category).toBe("auth");
    expect(db._state.content_items[0].status).toBe("failed");
  });

  it("returns 404 for an account with no deliveries (nothing to verify against)", async () => {
    const db = seedTwoWorkspaces();
    const body = JSON.stringify({
      event: "account.expired",
      timestamp: new Date().toISOString(),
      data: { account_id: "acct-unknown" },
    });
    const out = await handleSdrWebhook(
      { rawBody: body, signature: sign(body), eventType: "account.expired" },
      { db },
    );
    expect(out.status).toBe(404);
    expect(db._mutations).toHaveLength(0);
  });

  it("never verifies against a workspace whose webhook secret is NULL (empty-key HMAC)", async () => {
    const db = makeMockDb({
      workspace_sdr: [{ workspace_id: "ws-1", webhook_secret: null }],
      content_publications: [
        {
          id: "pub-1",
          workspace_id: "ws-1",
          content_item_id: "item-1",
          sdr_post_id: "job-1",
          sdr_target_id: "target-1",
          platform: "twitter",
          account_id: "acct-1",
          status: "publishing",
        },
      ],
      content_items: [],
    });
    const body = expired();
    const out = await handleSdrWebhook(
      { rawBody: body, signature: signWith("", body), eventType: "account.expired" },
      { db },
    );
    expect(out.status).toBe(401);
    expect(db._mutations).toHaveLength(0);
  });

  it("rejects a correctly signed but STALE callback (replay) with no state change", async () => {
    const db = seed();
    const body = JSON.stringify({
      event: "post.published",
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      data: { post_id: "job-1", target_id: "target-1", status: "published" },
    });
    const out = await handleSdrWebhook(
      { rawBody: body, signature: sign(body), eventType: "post.published" },
      { db },
    );
    expect(out.status).toBe(401);
    expect(db._mutations).toHaveLength(0);
  });

  it("rejects a signed callback with no timestamp", async () => {
    const db = seed();
    const body = JSON.stringify({
      event: "post.published",
      data: { post_id: "job-1", target_id: "target-1", status: "published" },
    });
    const out = await handleSdrWebhook(
      { rawBody: body, signature: sign(body), eventType: "post.published" },
      { db },
    );
    expect(out.status).toBe(401);
    expect(db._mutations).toHaveLength(0);
  });

  it("emits exactly one receipt per request, never including the body", async () => {
    const db = seedTwoWorkspaces();
    const receipts: unknown[] = [];
    await handleSdrWebhook(
      { rawBody: expired(), signature: null, eventType: "account.expired" },
      { db, onReceipt: (r) => receipts.push(r) },
    );
    expect(receipts).toEqual([
      expect.objectContaining({
        outcome: "rejected",
        reason: "invalid signature",
        workspaceId: "ws-1",
      }),
    ]);
    expect(JSON.stringify(receipts)).not.toContain("timestamp");
  });
});
