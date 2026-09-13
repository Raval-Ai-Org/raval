// Provider selection, SocialAPI env validation and the OAuth redirect guard.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDistributionProvider,
  getDistributionProviderForWorkspace,
  isSocialApiConfigured,
} from "@/lib/feature-flags";
import { checkEnv } from "@/server/env";
import { resolveConnectRedirect } from "@/lib/socialapi/route.server";

const KEYS = [
  "DISTRIBUTION_PROVIDER",
  "SOCIALAPI_API_KEY",
  "FEATURE_FLAG_SOCIALAPI_ENABLED",
  "FEATURE_FLAG_SOCIALAPI_ENABLED_WS_ws-off",
  "FEATURE_FLAG_SDR_ENABLED",
  "APP_URL",
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("distribution provider", () => {
  it("is off with nothing configured", () => {
    expect(getDistributionProvider()).toBeNull();
  });

  it("defaults to SocialAPI.ai when its key is present, even if the SDR flag is on", () => {
    process.env.SOCIALAPI_API_KEY = "sapi_key_abc";
    process.env.FEATURE_FLAG_SDR_ENABLED = "true";
    expect(isSocialApiConfigured()).toBe(true);
    expect(getDistributionProvider()).toBe("socialapi");
  });

  it("honours an explicit provider, and an explicit provider must be configured", () => {
    process.env.SOCIALAPI_API_KEY = "sapi_key_abc";
    process.env.FEATURE_FLAG_SDR_ENABLED = "true";
    process.env.DISTRIBUTION_PROVIDER = "sdr";
    expect(getDistributionProvider()).toBe("sdr");
    process.env.DISTRIBUTION_PROVIDER = "socialapi";
    delete process.env.SOCIALAPI_API_KEY;
    expect(getDistributionProvider()).toBeNull();
    process.env.DISTRIBUTION_PROVIDER = "none";
    process.env.SOCIALAPI_API_KEY = "sapi_key_abc";
    expect(getDistributionProvider()).toBeNull();
  });

  it("has global and per-workspace kill switches", () => {
    process.env.SOCIALAPI_API_KEY = "sapi_key_abc";
    process.env["FEATURE_FLAG_SOCIALAPI_ENABLED_WS_ws-off"] = "false";
    expect(getDistributionProviderForWorkspace("ws-on")).toBe("socialapi");
    expect(getDistributionProviderForWorkspace("ws-off")).toBeNull();
    process.env.FEATURE_FLAG_SOCIALAPI_ENABLED = "false";
    expect(getDistributionProviderForWorkspace("ws-on")).toBeNull();
  });
});

describe("checkEnv (SocialAPI.ai)", () => {
  it("requires the key when SocialAPI is the explicit provider", () => {
    const report = checkEnv({ NODE_ENV: "development", DISTRIBUTION_PROVIDER: "socialapi" });
    expect(report.errors).toContain(
      "SOCIALAPI_API_KEY is required when DISTRIBUTION_PROVIDER is socialapi",
    );
  });

  it("warns (not fails) when the webhook secret is missing", () => {
    const report = checkEnv({ NODE_ENV: "development", SOCIALAPI_API_KEY: "sapi_key_abc" });
    expect(report.warnings.some((w) => w.startsWith("SOCIALAPI_WEBHOOK_SECRET"))).toBe(true);
  });

  it("fails when a provider secret is exposed as NEXT_PUBLIC_*, without echoing the value", () => {
    const report = checkEnv({
      NODE_ENV: "development",
      NEXT_PUBLIC_SOCIALAPI_API_KEY: "sapi_key_leaky",
    });
    expect(report.errors.some((e) => e.startsWith("NEXT_PUBLIC_SOCIALAPI_API_KEY"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("sapi_key_leaky");
  });
});

describe("resolveConnectRedirect", () => {
  it("uses the deployment origin and never a foreign one", () => {
    process.env.APP_URL = "https://app.mellox.test";
    expect(resolveConnectRedirect("https://app.mellox.test")).toBe(
      "https://app.mellox.test/app/social/connected",
    );
    expect(resolveConnectRedirect("https://evil.example")).toBe(
      "https://app.mellox.test/app/social/connected",
    );
    expect(resolveConnectRedirect(undefined)).toBe("https://app.mellox.test/app/social/connected");
  });

  it("allows localhost outside production for local development", () => {
    process.env.APP_URL = "https://app.mellox.test";
    expect(resolveConnectRedirect("http://localhost:8080")).toBe(
      "http://localhost:8080/app/social/connected",
    );
  });
});
