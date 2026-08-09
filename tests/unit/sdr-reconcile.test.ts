// T055 — reconciliation (FR-018): a stale publishing publication is reconciled
// against the SDR job state so nothing strands in "publishing".
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockDb } from "../fixtures/mock-db";
import { reconcileStalePublications } from "@/lib/sdr.reconcile";
import { encryptSecret } from "@/lib/sdr-provisioning.server";

process.env.SDR_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");

describe("reconcileStalePublications", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addJob({
      job_id: "job-1", workspace_id: "ws-1", idempotency_key: "x", status: "published",
      targets: [{ target_id: "target-1", account_id: "tw-1", platform: "twitter", status: "published", platform_post_url: "https://x.com/status/1" }],
    });
  });
  afterAll(async () => await sdr.stop());

  it("reconciles a stale publishing publication to the SDR's terminal state", async () => {
    const db = makeMockDb({
      workspace_sdr: [{ workspace_id: "ws-1", encrypted_api_key: encryptSecret("ws-key") }],
      content_publications: [{
        id: "pub-1", workspace_id: "ws-1", content_item_id: "item-1", sdr_post_id: "job-1", sdr_target_id: "target-1",
        platform: "twitter", account_id: "tw-1", status: "publishing", updated_at: "2026-08-01T00:00:00Z",
      }],
    });
    const out = await reconcileStalePublications({
      db,
      sdrBaseUrl: sdr.baseUrl,
      getToken: async () => "ws-key",
      staleMs: 60_000,
    });
    expect(out.swept).toBe(1);
    expect(out.reconciled).toHaveLength(1);
    expect(out.reconciled[0].status).toBe("published");
    expect(db._state.content_publications[0].status).toBe("published");
    expect(db._state.content_publications[0].platform_post_url).toBe("https://x.com/status/1");
  });

  it("leaves a non-terminal SDR state untouched (still retrying)", async () => {
    const db = makeMockDb({
      workspace_sdr: [{ workspace_id: "ws-1", encrypted_api_key: encryptSecret("ws-key") }],
      content_publications: [{
        id: "pub-2", workspace_id: "ws-1", content_item_id: "item-2", sdr_post_id: "job-unknown", sdr_target_id: "target-2",
        platform: "twitter", account_id: "tw-1", status: "publishing", updated_at: "2026-08-01T00:00:00Z",
      }],
    });
    const out = await reconcileStalePublications({ db, sdrBaseUrl: sdr.baseUrl, getToken: async () => "ws-key", staleMs: 60_000 });
    expect(out.reconciled).toHaveLength(0);
    expect(db._state.content_publications[0].status).toBe("publishing");
  });
});
