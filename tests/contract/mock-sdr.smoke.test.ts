// Sanity check that the MockSDR fixture serves the SDR contract surface
// correctly (specs/001-sdr-integration/contracts/sdr-proxy.md). Guards the
// fixture against drift so downstream contract tests can trust it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";

describe("MockSDR fixture", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({ account_id: "test-account-1", platform: "dryrun", platform_username: "DryRun One", status: "active" });
    sdr.addAccount({ account_id: "acc-2", platform: "dryrun", platform_username: "Two", status: "active" });
  });
  afterAll(async () => await sdr.stop());

  it("requires a Bearer token (401 without)", async () => {
    const res = await fetch(`${sdr.baseUrl}/api/v1/accounts`);
    expect(res.status).toBe(401);
  });

  it("lists accounts", async () => {
    const res = await fetch(`${sdr.baseUrl}/api/v1/accounts`, {
      headers: { Authorization: "Bearer mock-token" },
    });
    expect(res.status).toBe(200);
    const accounts = await res.json();
    expect(accounts).toHaveLength(2);
    expect(accounts[0].account_id).toBe("test-account-1");
  });

  it("publishes and returns a job with per-target status", async () => {
    const res = await fetch(`${sdr.baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotency_key: "smoke-1",
        targets: [{ account_id: "test-account-1", content: { text: "hi" } }],
      }),
    });
    expect(res.status).toBe(201);
    const job = await res.json();
    expect(job.job_id).toBeTruthy();
    expect(job.targets).toHaveLength(1);
    expect(job.targets[0].account_id).toBe("test-account-1");
  });

  it("returns the same job for the same idempotency key", async () => {
    const body = {
      idempotency_key: "smoke-1",
      targets: [{ account_id: "test-account-1", content: { text: "hi" } }],
    };
    const a = await (await fetch(`${sdr.baseUrl}/api/v1/publish`, {
      method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" }, body: JSON.stringify(body),
    })).json();
    const b = await (await fetch(`${sdr.baseUrl}/api/v1/publish`, {
      method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" }, body: JSON.stringify(body),
    })).json();
    expect(a.job_id).toBe(b.job_id);
  });

  it("rejects unknown platforms on oauth start (400)", async () => {
    const res = await fetch(`${sdr.baseUrl}/api/v1/oauth/tiktok/start`, {
      headers: { Authorization: "Bearer mock-token" },
    });
    expect(res.status).toBe(400);
  });

  it("supports forcing errors (503) and records requests", async () => {
    sdr.force("/api/v1/publish", 503, { error_code: "SDR_DOWN" });
    const res = await fetch(`${sdr.baseUrl}/api/v1/publish`, {
      method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: "x", targets: [{ account_id: "a", content: { text: "t" } }] }),
    });
    expect(res.status).toBe(503);
    const reqs = sdr.getRequests();
    expect(reqs.some((r) => r.path === "/api/v1/publish" && r.method === "POST")).toBe(true);
    sdr.reset();
  });
});
