// T019 — contract test: POST /api/sdr/oauth/start handler (spec FR-001/FR-004).
// Exercises the pure handler against the MockSDR (no Supabase, no network).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { oauthStartHandler } from "@/lib/sdr.handlers";

describe("oauthStartHandler (POST /api/sdr/oauth/start)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => await sdr.start());
  afterAll(async () => await sdr.stop());

  const deps = () => ({ sdrBaseUrl: sdr.baseUrl, token: "ws-key" });

  it("returns an authorization URL + state token for a supported platform", async () => {
    const out = await oauthStartHandler("twitter", deps());
    expect(out.status).toBe(200);
    expect(out.body.authorizationUrl).toContain("mock-oauth/twitter");
    expect(typeof out.body.stateToken).toBe("string");
    expect(out.body.stateToken.length).toBeGreaterThan(0);
  });

  it("rejects an unknown platform with 400 (PLATFORM_VALIDATION)", async () => {
    const out = await oauthStartHandler("tiktok", deps());
    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe("PLATFORM_VALIDATION");
  });

  it("maps SDR-unreachable to a 503 error envelope", async () => {
    sdr.force("/api/v1/oauth/twitter/start", 503, { error_code: "SDR_DOWN" });
    const out = await oauthStartHandler("twitter", deps());
    expect(out.status).toBe(503);
    expect(out.body.error).toBeTruthy();
    sdr.reset();
  });
});
