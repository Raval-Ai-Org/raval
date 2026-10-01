import { afterEach, describe, expect, it, vi } from "vitest";
import { globalBillingMode } from "./mode.server";

afterEach(() => vi.unstubAllEnvs());

describe("global billing enforcement", () => {
  it("charges by default in production when the setting is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ENFORCEMENT", undefined);
    expect(globalBillingMode()).toBe("on");
  });

  it("honors an explicit off or shadow setting", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ENFORCEMENT", "off");
    expect(globalBillingMode()).toBe("off");
    vi.stubEnv("BILLING_ENFORCEMENT", "shadow");
    expect(globalBillingMode()).toBe("shadow");
  });
});
