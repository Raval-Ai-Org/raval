import { describe, expect, it } from "vitest";
import { isCompedAt, windowAfterCancel, type CancelWindowAccount } from "./cancel-window";

const NOW = new Date("2026-10-20T21:08:20.000Z");

const base: CancelWindowAccount = {
  status: "active",
  next_grant_at: "2026-11-20T20:54:36.000Z",
  grant_anchor: "2026-10-20T20:54:36.000Z",
  comped_plan_id: null,
  comped_until: null,
};

describe("windowAfterCancel", () => {
  it("starts the Free window now for an ordinary account", () => {
    expect(windowAfterCancel(base, NOW)).toEqual({
      nextGrantAt: NOW.toISOString(),
      grantAnchor: NOW.toISOString(),
    });
  });

  it("does not restart the window of an account on a comped plan", () => {
    const comped = { ...base, comped_plan_id: "scale", comped_until: "2099-01-01T00:00:00.000Z" };
    expect(windowAfterCancel(comped, NOW)).toEqual({
      nextGrantAt: base.next_grant_at,
      grantAnchor: base.grant_anchor,
    });
  });

  it("restarts the window once the comp has ended", () => {
    const ended = { ...base, comped_plan_id: "scale", comped_until: "2026-01-01T00:00:00.000Z" };
    expect(windowAfterCancel(ended, NOW).nextGrantAt).toBe(NOW.toISOString());
  });

  it("leaves an already-cancelled account alone when the webhook repeats", () => {
    const canceled = { ...base, status: "canceled" };
    expect(windowAfterCancel(canceled, NOW)).toEqual({
      nextGrantAt: base.next_grant_at,
      grantAnchor: base.grant_anchor,
    });
  });

  it("falls back to now when there is nothing to keep", () => {
    const comped = {
      ...base,
      next_grant_at: null,
      grant_anchor: null,
      comped_plan_id: "scale",
      comped_until: "2099-01-01T00:00:00.000Z",
    };
    expect(windowAfterCancel(comped, NOW)).toEqual({
      nextGrantAt: NOW.toISOString(),
      grantAnchor: NOW.toISOString(),
    });
  });
});

describe("isCompedAt", () => {
  it("needs both a plan and a future end date", () => {
    expect(isCompedAt({ comped_plan_id: null, comped_until: "2099-01-01T00:00:00Z" }, NOW)).toBe(
      false,
    );
    expect(isCompedAt({ comped_plan_id: "scale", comped_until: null }, NOW)).toBe(false);
    expect(isCompedAt({ comped_plan_id: "scale", comped_until: "2099-01-01T00:00:00Z" }, NOW)).toBe(
      true,
    );
  });
});
