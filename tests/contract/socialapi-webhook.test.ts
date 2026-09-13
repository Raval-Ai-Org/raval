// SocialAPI.ai webhook receiver: v2 signature, replay window, registration
// ping, delivery-id dedupe, terminal-wins application, account events.
import { describe, expect, it, vi } from "vitest";
import {
  handleSocialApiWebhook,
  signSocialApiPayload,
  type SocialWebhookReceipt,
} from "@/lib/socialapi/webhook";
import { createMemoryDb } from "../fixtures/memory-supabase";

const SECRET = "whsec_test_secret";
const NOW = Date.parse("2026-09-14T12:00:00Z");
const TS = String(Math.floor(NOW / 1000));

function seed() {
  return createMemoryDb({
    content_items: [{ id: "item-1", workspace_id: "ws-1", status: "publishing", meta: {} }],
    content_publications: [
      {
        id: "pub-1",
        workspace_id: "ws-1",
        content_item_id: "item-1",
        provider: "socialapi",
        sdr_post_id: "post-1",
        sdr_target_id: "acc_li",
        platform: "linkedin",
        account_id: "acc_li",
        status: "publishing",
        attempt: 0,
      },
    ],
    social_accounts: [
      {
        id: "sa-1",
        workspace_id: "ws-1",
        provider: "socialapi",
        provider_account_id: "acc_li",
        status: "active",
      },
    ],
    workspace_socialapi: [{ workspace_id: "ws-1", brand_id: "brand-1", status: "active" }],
  });
}

function input(
  body: object,
  overrides: Partial<Parameters<typeof handleSocialApiWebhook>[0]> = {},
) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    timestamp: TS,
    signature: signSocialApiPayload(SECRET, TS, rawBody),
    deliveryId: "dlv-1",
    eventHeader: (body as { event: string }).event,
    maxBodyBytes: 1_000_000,
    ...overrides,
  };
}

const published = {
  event: "post.published",
  data: {
    post_id: "post-1",
    status: "published",
    results: [
      {
        account_id: "acc_li",
        platform: "linkedin",
        status: "published",
        platform_post_id: "urn:li:share:1",
        permalink: "https://www.linkedin.com/feed/update/urn:li:share:1",
      },
    ],
  },
};

describe("handleSocialApiWebhook", () => {
  it("applies a verified post.published: delivery row + item status", async () => {
    const db = seed();
    const receipts: SocialWebhookReceipt[] = [];
    const out = await handleSocialApiWebhook(input(published), {
      db,
      secret: SECRET,
      now: () => NOW,
      onReceipt: (r) => receipts.push(r),
    });
    expect(out.status).toBe(200);
    expect(db.rows("content_publications")[0]).toMatchObject({
      status: "published",
      platform_post_url: "https://www.linkedin.com/feed/update/urn:li:share:1",
    });
    expect(db.rows("content_items")[0].status).toBe("published");
    expect(receipts[0]).toMatchObject({ outcome: "verified", provider: "socialapi" });
  });

  it("rejects a bad signature before touching any data", async () => {
    const db = seed();
    const out = await handleSocialApiWebhook(input(published, { signature: "sha256=deadbeef" }), {
      db,
      secret: SECRET,
      now: () => NOW,
    });
    expect(out.status).toBe(401);
    expect(db.writes).toHaveLength(0);
    expect(db.rows("content_publications")[0].status).toBe("publishing");
  });

  it("rejects a correctly signed but stale delivery (replay)", async () => {
    const db = seed();
    const oldTs = String(Math.floor(NOW / 1000) - 3600);
    const body = JSON.stringify(published);
    const out = await handleSocialApiWebhook(
      input(published, { timestamp: oldTs, signature: signSocialApiPayload(SECRET, oldTs, body) }),
      { db, secret: SECRET, now: () => NOW },
    );
    expect(out.status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("acknowledges the unsigned registration ping without side effects", async () => {
    const db = seed();
    const out = await handleSocialApiWebhook(
      {
        rawBody: "{}",
        timestamp: null,
        signature: null,
        deliveryId: null,
        eventHeader: "webhook.test",
      },
      { db, secret: "", now: () => NOW },
    );
    expect(out.status).toBe(200);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses everything when no secret is configured", async () => {
    const out = await handleSocialApiWebhook(input(published), {
      db: seed(),
      secret: "",
      now: () => NOW,
    });
    expect(out.status).toBe(503);
  });

  it("processes a delivery id once", async () => {
    const db = seed();
    const seen = new Set<string>();
    const deps = {
      db,
      secret: SECRET,
      now: () => NOW,
      claimDelivery: async (r: SocialWebhookReceipt) => {
        if (seen.has(r.deliveryId!)) return false;
        seen.add(r.deliveryId!);
        return true;
      },
    };
    expect((await handleSocialApiWebhook(input(published), deps)).status).toBe(200);
    const writesAfterFirst = db.writes.length;
    const second = await handleSocialApiWebhook(input(published), deps);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(db.writes.length).toBe(writesAfterFirst);
  });

  it("never downgrades a published delivery on a later failure event", async () => {
    const db = seed();
    await handleSocialApiWebhook(input(published), { db, secret: SECRET, now: () => NOW });
    const failed = {
      event: "post.failed",
      data: {
        post_id: "post-1",
        status: "failed",
        results: [{ account_id: "acc_li", status: "failed", error: { message: "x" } }],
      },
    };
    await handleSocialApiWebhook(input(failed, { deliveryId: "dlv-2" }), {
      db,
      secret: SECRET,
      now: () => NOW,
    });
    expect(db.rows("content_publications")[0].status).toBe("published");
  });

  it("ignores posts Mellox didn't create (no tenant data touched)", async () => {
    const db = seed();
    const other = { event: "post.published", data: { post_id: "post-elsewhere", results: [] } };
    const out = await handleSocialApiWebhook(input(other), { db, secret: SECRET, now: () => NOW });
    expect(out).toMatchObject({ status: 200, body: { ignored: "unknown post" } });
    expect(db.writes).toHaveLength(0);
  });

  it("marks an account for reconnection on account.disconnected", async () => {
    const db = seed();
    const event = {
      event: "account.disconnected",
      data: {
        account_id: "acc_li",
        platform: "linkedin",
        reason: "access_revoked",
        reconnect_required: true,
      },
    };
    await handleSocialApiWebhook(input(event), { db, secret: SECRET, now: () => NOW });
    expect(db.rows("social_accounts")[0]).toMatchObject({
      status: "reconnect_required",
      reconnect_reason: "access_revoked",
    });
  });

  it("releases the delivery claim when applying fails so the provider retry is processed", async () => {
    const db = seed();
    const broken = {
      ...db,
      from: vi.fn(() => {
        throw new Error("db down");
      }),
    };
    const release = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await handleSocialApiWebhook(input(published), {
      db: broken,
      secret: SECRET,
      now: () => NOW,
      claimDelivery: async () => true,
      releaseDelivery: release,
    });
    expect(out.status).toBe(500);
    expect(release).toHaveBeenCalledWith("dlv-1");
  });
});
