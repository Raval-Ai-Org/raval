// T020 — contract tests: GET /api/sdr/accounts + POST /api/sdr/disconnect
// handlers (spec FR-002/FR-003). Tokens never exposed; mapping to the
// ConnectedAccount shape is asserted.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR, type MockAccount } from "../fixtures/mock-sdr";
import { listAccountsHandler, disconnectHandler } from "@/lib/sdr.handlers";

describe("listAccountsHandler (GET /api/sdr/accounts)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({
      account_id: "test-account-1",
      platform: "dryrun",
      platform_username: "DryRun One",
      status: "active",
    });
    sdr.addAccount({
      account_id: "exp-1",
      platform: "linkedin",
      platform_username: "Expired Page",
      status: "expired",
    });
  });
  afterAll(async () => await sdr.stop());

  const deps = () => ({ sdrBaseUrl: sdr.baseUrl, token: "ws-key" });

  it("lists connected accounts in the ConnectedAccount shape (no tokens)", async () => {
    const out = await listAccountsHandler(deps());
    expect(out.status).toBe(200);
    expect(out.body).toHaveLength(2);
    const first = out.body[0];
    expect(first).toMatchObject({
      accountId: "test-account-1",
      platform: "dryrun",
      platformUsername: "DryRun One",
      status: "active",
    });
    expect("account_id" in first).toBe(false); // no raw SDR field leaks
    expect(first.tokenExpiresAt).toBeNull();
  });

  it("returns a clean empty list when no accounts are connected", async () => {
    const empty = new MockSDR();
    await empty.start();
    try {
      const out = await listAccountsHandler({ sdrBaseUrl: empty.baseUrl, token: "ws-key" });
      expect(out.status).toBe(200);
      expect(out.body).toEqual([]);
    } finally {
      await empty.stop();
    }
  });

  it("maps SDR-unreachable to a 503 error envelope", async () => {
    sdr.force("/api/v1/accounts", 503, { error_code: "SDR_DOWN" });
    const out = await listAccountsHandler(deps());
    expect(out.status).toBe(503);
    expect(out.body.error).toBeTruthy();
    sdr.reset();
  });
});

describe("disconnectHandler (POST /api/sdr/disconnect)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({
      account_id: "test-account-1",
      platform: "dryrun",
      platform_username: "One",
      status: "active",
    });
  });
  afterAll(async () => await sdr.stop());

  const deps = () => ({ sdrBaseUrl: sdr.baseUrl, token: "ws-key" });

  it("disconnects an existing account (204)", async () => {
    const out = await disconnectHandler("test-account-1", deps());
    expect(out.status).toBe(204);
  });

  it("returns 404 for an unknown account", async () => {
    const out = await disconnectHandler("does-not-exist", deps());
    expect(out.status).toBe(404);
  });

  it("rejects a missing accountId with 400", async () => {
    const out = await disconnectHandler("", deps());
    expect(out.status).toBe(400);
  });
});
