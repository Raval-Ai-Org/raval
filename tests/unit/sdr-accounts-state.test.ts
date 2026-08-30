// T021 — account-state gating (spec FR-004): expired/disconnected accounts are
// never offered as publish targets; only active ones are. Reconnect = the
// oauth/start handler (asserted here at the gating level).
import { describe, it, expect } from "vitest";
import {
  isAccountPublishable,
  getPublishableAccounts,
  resolveTargetAccounts,
} from "@/lib/sdr.targets";
import type { ConnectedAccount } from "@/lib/sdr.handlers";

const active: ConnectedAccount = {
  accountId: "a1",
  platform: "linkedin",
  platformUsername: "A",
  status: "active",
  tokenExpiresAt: null,
};
const expired: ConnectedAccount = {
  accountId: "a2",
  platform: "twitter",
  platformUsername: "B",
  status: "expired",
  tokenExpiresAt: "2026-08-01T00:00:00Z",
};
const disconnected: ConnectedAccount = {
  accountId: "a3",
  platform: "instagram",
  platformUsername: "C",
  status: "disconnected",
  tokenExpiresAt: null,
};

describe("isAccountPublishable", () => {
  it("only active accounts are publishable (FR-004)", () => {
    expect(isAccountPublishable(active)).toBe(true);
    expect(isAccountPublishable(expired)).toBe(false);
    expect(isAccountPublishable(disconnected)).toBe(false);
    expect(isAccountPublishable(undefined)).toBe(false);
  });
});

describe("getPublishableAccounts", () => {
  it("filters out expired + disconnected accounts", () => {
    expect(getPublishableAccounts([active, expired, disconnected])).toEqual([active]);
  });
});

describe("resolveTargetAccounts", () => {
  const accounts = [
    active,
    expired,
    disconnected,
    {
      accountId: "a4",
      platform: "linkedin",
      platformUsername: "D",
      status: "active",
      tokenExpiresAt: null,
    },
  ];

  it("resolves a specific active account", () => {
    expect(resolveTargetAccounts(accounts, { type: "account", accountId: "a1" })).toEqual([active]);
  });

  it("never resolves an expired account even if selected (FR-004)", () => {
    expect(resolveTargetAccounts(accounts, { type: "account", accountId: "a2" })).toEqual([]);
  });

  it("resolves a platform to only its active accounts", () => {
    expect(
      resolveTargetAccounts(accounts, { type: "platform", platform: "linkedin" }).map(
        (a) => a.accountId,
      ),
    ).toEqual(["a1", "a4"]);
  });

  it("resolves 'all' to every active account", () => {
    expect(resolveTargetAccounts(accounts, { type: "all" }).map((a) => a.accountId)).toEqual([
      "a1",
      "a4",
    ]);
  });
});
