import { describe, expect, it } from "vitest";
import { sweepVerdict } from "./accounts.server";
import type { ComposioAccount } from "./composio/gateway.server";

const account = (patch: Partial<ComposioAccount>): ComposioAccount => ({
  id: "ca_1",
  status: "ACTIVE",
  statusReason: null,
  toolkit: "instagram",
  authConfigId: "ac_1",
  isDisabled: false,
  userId: null,
  wordId: null,
  alias: null,
  ...patch,
});

describe("sweepVerdict", () => {
  it("keeps a working account active", () => {
    expect(sweepVerdict(account({}))).toEqual({ status: "active", reason: null });
  });

  it("asks for a reconnect when the grant is gone or disabled", () => {
    expect(sweepVerdict(account({ status: "EXPIRED", statusReason: "refresh failed" }))).toEqual({
      status: "reconnect_required",
      reason: "refresh failed",
    });
    expect(sweepVerdict(account({ isDisabled: true })).status).toBe("reconnect_required");
    expect(sweepVerdict(account({ status: "INITIATED" })).reason).toBe("sign-in never finished");
  });

  it("disconnects an account removed at Composio", () => {
    expect(sweepVerdict(null).status).toBe("disconnected");
  });
});
