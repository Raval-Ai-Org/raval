// T022 — integration: connect → appear → expire → reconnect → re-offered.
// Uses the MockSDR + the handlers + target-gating, simulating the account
// lifecycle the SDR reports via GET /accounts (status active/expired).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR, type MockAccount } from "../fixtures/mock-sdr";
import { listAccountsHandler, oauthStartHandler } from "@/lib/sdr.handlers";
import { getPublishableAccounts } from "@/lib/sdr.targets";
import type { ConnectedAccount } from "@/lib/sdr.handlers";

describe("connect → appear → expire → reconnect flow", () => {
  const sdr = new MockSDR();
  const deps = () => ({ sdrBaseUrl: sdr.baseUrl, token: "ws-key" });

  beforeAll(async () => {
    await sdr.start();
    // Start with no accounts — user connects LinkedIn for the first time.
  });
  afterAll(async () => await sdr.stop());

  it("starts empty, then a connected account appears", async () => {
    expect(await listAccountsHandler(deps())).toEqual({ status: 200, body: [] });

    sdr.addAccount({
      account_id: "li-1",
      platform: "linkedin",
      platform_username: "Brand Page",
      status: "active",
    });
    const listed = (await listAccountsHandler(deps())).body as ConnectedAccount[];
    expect(listed).toHaveLength(1);
    expect(getPublishableAccounts(listed).map((a) => a.accountId)).toEqual(["li-1"]);
  });

  it("an expired account is still listed but NOT publishable (FR-004)", async () => {
    const acc = sdr.getAccounts?.() ?? [];
    // mark the linkedin account expired as the SDR would on token expiry
    const listed = (await listAccountsHandler(deps())).body as ConnectedAccount[];
    const target = listed.find((a) => a.accountId === "li-1")!;
    sdr.setAccountStatus(target.accountId, "expired");
    const after = (await listAccountsHandler(deps())).body as ConnectedAccount[];
    expect(after[0].status).toBe("expired");
    expect(getPublishableAccounts(after)).toEqual([]);
  });

  it("reconnect reuses oauth/start and the account returns to active", async () => {
    const start = await oauthStartHandler("linkedin", deps());
    expect(start.status).toBe(200);
    expect(start.body.authorizationUrl).toContain("linkedin");

    // Simulate the re-authorization completing → SDR reports active again.
    sdr.setAccountStatus("li-1", "active");
    const after = (await listAccountsHandler(deps())).body as ConnectedAccount[];
    expect(after[0].status).toBe("active");
    expect(getPublishableAccounts(after).map((a) => a.accountId)).toEqual(["li-1"]);
  });
});
