import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matchesNotionBrowserState, validNotionState } from "./oauth.server";
const state = "a".repeat(64);
const row = {
  user_id: "user-one",
  consumed_at: null,
  expires_at: new Date(Date.now() + 60000).toISOString(),
};
describe("Notion OAuth state", () => {
  it("requires a matching browser cookie", () => {
    const hash = createHash("sha256").update(state).digest("hex");
    expect(matchesNotionBrowserState(state, hash)).toBe(true);
    expect(matchesNotionBrowserState("b".repeat(64), hash)).toBe(false);
    expect(matchesNotionBrowserState(state, undefined)).toBe(false);
  });
  it("requires the initiating user and a live, unused state", () => {
    expect(validNotionState(state, row, "user-one")).toBe(true);
    expect(validNotionState(state, row, "other-user")).toBe(false);
    expect(
      validNotionState(state, { ...row, consumed_at: new Date().toISOString() }, "user-one"),
    ).toBe(false);
    expect(
      validNotionState(state, { ...row, expires_at: new Date(0).toISOString() }, "user-one"),
    ).toBe(false);
    expect(validNotionState("short", row, "user-one")).toBe(false);
  });
});
