import { createHmac, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  checkGitHubConfig,
  getGitHubDiagnostic,
  normalizePrivateKey,
  resolveInstallVerification,
} from "./config.server";
import { signAppJwt } from "./api.server";
import { handleGitHubWebhook, verifyGitHubSignature, type WebhookDeps } from "./webhook";
import { buildInspection, detectFramework, findDiscoveryFiles } from "./inspect";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const BASE_ENV = {
  GITHUB_APP_ID: "4940721",
  GITHUB_APP_SLUG: "mellox-ai-test",
  GITHUB_APP_PRIVATE_KEY: PEM,
  GITHUB_WEBHOOK_SECRET: "whsec_test_value_1234567890",
  GITHUB_APP_NAME: "Mellox AI Test",
  GITHUB_CLIENT_ID: "Iv1.test",
  GITHUB_CLIENT_SECRET: "client-secret-test",
  NODE_ENV: "test",
};

describe("GitHub App config", () => {
  it("accepts the private key with real newlines, escaped \\n, quotes or base64", () => {
    expect(normalizePrivateKey(PEM)).toContain("BEGIN RSA PRIVATE KEY");
    expect(normalizePrivateKey(PEM.replace(/\n/g, "\\n"))).toBe(PEM.trim());
    expect(normalizePrivateKey(`"${PEM}"`)).toBe(PEM.trim());
    expect(normalizePrivateKey(Buffer.from(PEM).toString("base64"))).toBe(PEM.trim());
    // A value truncated to its first line (unquoted multiline .env) is rejected.
    expect(normalizePrivateKey("-----BEGIN RSA PRIVATE KEY-----")).toBeNull();
    expect(normalizePrivateKey(undefined)).toBeNull();
  });

  it("reports missing variables by name without echoing values", () => {
    const check = checkGitHubConfig({ NODE_ENV: "test" });
    expect(check.ok).toBe(false);
    expect(check.issues.join(" ")).toMatch(/GITHUB_APP_ID/);
    expect(check.issues.join(" ")).toMatch(/GITHUB_APP_PRIVATE_KEY/);
    const bad = checkGitHubConfig({ ...BASE_ENV, GITHUB_APP_PRIVATE_KEY: "not-a-key" });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("not-a-key");
  });

  it("verifies installs with OAuth when the client secret is set, and refuses unverifiable installs in production", () => {
    expect(
      resolveInstallVerification({
        GITHUB_CLIENT_ID: "Iv1",
        GITHUB_CLIENT_SECRET: "s",
        NODE_ENV: "production",
      }),
    ).toBe("oauth");
    expect(resolveInstallVerification({ NODE_ENV: "production" })).toBe("unavailable");
    expect(resolveInstallVerification({ NODE_ENV: "development" })).toBe("install_window");
    expect(
      resolveInstallVerification({
        NODE_ENV: "production",
        GITHUB_INSTALL_VERIFICATION: "install_window",
      }),
    ).toBe("install_window");
    const check = checkGitHubConfig(BASE_ENV);
    expect(check.ok && check.config.installVerification).toBe("oauth");
  });

  it("signs a valid RS256 App JWT with a drift-tolerant window", () => {
    const check = checkGitHubConfig(BASE_ENV);
    if (!check.ok) throw new Error("config should be valid");
    const jwt = signAppJwt(check.config, 1_700_000_000);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iat: 1_700_000_000 - 60,
      exp: 1_700_000_000 + 540,
      iss: "4940721",
    });
    const ok = verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey(privateKey),
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("returns only safe statuses for production-style configuration", () => {
    const diagnostic = getGitHubDiagnostic({
      ...BASE_ENV,
      APP_URL: "https://raval-production-c901.up.railway.app",
      GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"),
    });
    expect(diagnostic).toEqual({
      appIdPresent: true,
      appSlugPresent: true,
      appNamePresent: true,
      privateKeyPresent: true,
      privateKeyValid: true,
      webhookSecretPresent: true,
      clientIdPresent: true,
      clientSecretPresent: true,
      appUrlPresent: true,
      appUrlHttps: true,
      callbackUrlValid: true,
      webhookUrlValid: true,
      appJwtGenerationValid: true,
      githubApiReachable: false,
      oauthConfigurationValid: false,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(PEM);
  });

  it("treats blank Railway values as absent", () => {
    const diagnostic = getGitHubDiagnostic({
      GITHUB_APP_ID: "",
      GITHUB_APP_SLUG: " ",
      GITHUB_APP_NAME: "",
      GITHUB_APP_PRIVATE_KEY: "\n",
      GITHUB_WEBHOOK_SECRET: "",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: " ",
      APP_URL: "",
    });
    expect(diagnostic).toEqual({
      appIdPresent: false,
      appSlugPresent: false,
      appNamePresent: false,
      privateKeyPresent: false,
      privateKeyValid: false,
      webhookSecretPresent: false,
      clientIdPresent: false,
      clientSecretPresent: false,
      appUrlPresent: false,
      appUrlHttps: false,
      callbackUrlValid: false,
      webhookUrlValid: false,
      appJwtGenerationValid: false,
      githubApiReachable: false,
      oauthConfigurationValid: false,
    });
  });

  it("rejects localhost as a production callback origin", () => {
    expect(
      getGitHubDiagnostic({ ...BASE_ENV, APP_URL: "http://localhost:8080" })
        .appUrlHttps,
    ).toBe(false);
  });
});

const SECRET = "whsec_test_value_1234567890";
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const DELIVERY = "7a2f1c30-4b5e-11ef-8f1a-0242ac120002";

function deps(overrides: Partial<WebhookDeps> = {}) {
  const calls: Record<string, unknown[]> = {
    update: [],
    lost: [],
    restore: [],
    audit: [],
    reject: [],
    forget: [],
  };
  const claimed = new Set<string>();
  const base: WebhookDeps = {
    secret: SECRET,
    claimDelivery: async (r) => {
      if (claimed.has(r.deliveryId!)) return false;
      claimed.add(r.deliveryId!);
      return true;
    },
    recordRejection: (r) => void calls.reject.push(r),
    findConnections: async (id) =>
      id === "111" ? [{ id: "c1", workspaceId: "w1", status: "active" }] : [],
    updateConnections: async (id, patch) => void calls.update.push({ id, patch }),
    markSourcesAccessLost: async (id, repos) => {
      calls.lost.push({ id, repos });
      return 1;
    },
    restoreSources: async (id, repos) => {
      calls.restore.push({ id, repos });
      return repos.length;
    },
    audit: async (_c, action) => void calls.audit.push(action),
    forgetToken: (id) => void calls.forget.push(id),
    now: () => new Date("2026-09-15T10:00:00Z"),
    ...overrides,
  };
  return { deps: base, calls };
}

describe("GitHub webhook", () => {
  const body = JSON.stringify({ action: "deleted", installation: { id: 111 } });

  it("verifies the HMAC signature in constant time", () => {
    expect(verifyGitHubSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyGitHubSignature(body, sign(body, "wrong"), SECRET)).toBe(false);
    expect(verifyGitHubSignature(`${body} `, sign(body), SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, null, SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, sign(body), "")).toBe(false);
  });

  it("rejects bad signatures, a missing secret and missing delivery ids without touching state", async () => {
    const { deps: d, calls } = deps();
    expect(
      (
        await handleGitHubWebhook(
          {
            rawBody: body,
            signature: sign(body, "nope"),
            event: "installation",
            deliveryId: DELIVERY,
          },
          d,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleGitHubWebhook(
          { rawBody: body, signature: sign(body), event: "installation", deliveryId: DELIVERY },
          { ...d, secret: "" },
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await handleGitHubWebhook(
          { rawBody: body, signature: sign(body), event: "installation", deliveryId: null },
          d,
        )
      ).status,
    ).toBe(400);
    expect(calls.update).toHaveLength(0);
    expect(calls.reject).toHaveLength(3);
  });

  it("revokes connections and sources when the app is uninstalled, once per delivery", async () => {
    const { deps: d, calls } = deps();
    const input = {
      rawBody: body,
      signature: sign(body),
      event: "installation",
      deliveryId: DELIVERY,
    };
    const first = await handleGitHubWebhook(input, d);
    expect(first).toEqual({ status: 200, body: { ok: true, handled: "installation.deleted" } });
    expect(calls.update[0]).toMatchObject({
      id: "111",
      patch: { status: "revoked", revoked_reason: "uninstalled_on_github" },
    });
    expect(calls.lost[0]).toEqual({ id: "111", repos: "all" });
    expect(calls.forget).toEqual(["111"]);
    expect(calls.audit).toEqual(["connector.github.uninstalled"]);
    const again = await handleGitHubWebhook(input, d);
    expect(again.body).toMatchObject({ duplicate: true });
    expect(calls.update).toHaveLength(1);
  });

  it("tracks suspension and repository access changes, and ignores unlinked installations", async () => {
    const { deps: d, calls } = deps();
    const suspend = JSON.stringify({ action: "suspend", installation: { id: 111 } });
    await handleGitHubWebhook(
      { rawBody: suspend, signature: sign(suspend), event: "installation", deliveryId: DELIVERY },
      d,
    );
    expect(calls.update[0]).toMatchObject({ patch: { status: "suspended" } });

    const repos = JSON.stringify({
      action: "removed",
      installation: { id: 111 },
      repository_selection: "selected",
      repositories_removed: [{ id: 42 }],
      repositories_added: [{ id: 7 }],
    });
    const res = await handleGitHubWebhook(
      {
        rawBody: repos,
        signature: sign(repos),
        event: "installation_repositories",
        deliveryId: "8a2f1c30-4b5e-11ef-8f1a-0242ac120002",
      },
      d,
    );
    expect(res.body).toMatchObject({ lost: 1, restored: 1 });
    expect(calls.lost.at(-1)).toEqual({ id: "111", repos: ["42"] });
    expect(calls.restore.at(-1)).toEqual({ id: "111", repos: ["7"] });

    const other = JSON.stringify({ action: "created", installation: { id: 999 } });
    const ignored = await handleGitHubWebhook(
      {
        rawBody: other,
        signature: sign(other),
        event: "installation",
        deliveryId: "9a2f1c30-4b5e-11ef-8f1a-0242ac120002",
      },
      d,
    );
    expect(ignored.body).toMatchObject({ ignored: "installation not linked" });
  });

  it("answers pings without a database write", async () => {
    const claim = vi.fn();
    const { deps: d } = deps({ claimDelivery: claim });
    const ping = JSON.stringify({ zen: "Keep it logically awesome.", hook_id: 1 });
    const res = await handleGitHubWebhook(
      { rawBody: ping, signature: sign(ping), event: "ping", deliveryId: DELIVERY },
      d,
    );
    expect(res.body).toMatchObject({ pong: true });
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("source inspection", () => {
  it("detects the framework from dependencies, then from root files", () => {
    expect(
      detectFramework(["package.json"], { dependencies: { next: "16.0.0", react: "19" } })
        .framework,
    ).toBe("Next.js");
    expect(detectFramework(["package.json"], { devDependencies: { astro: "5" } }).framework).toBe(
      "Astro",
    );
    expect(detectFramework(["hugo.toml", "content"], null).framework).toBe("Hugo");
    expect(detectFramework(["README.md"], null)).toEqual({ framework: null, evidence: null });
  });

  it("finds discovery files at the shallowest path and ignores build output", () => {
    const files = findDiscoveryFiles([
      "node_modules/pkg/robots.txt",
      "fixtures/deep/robots.txt",
      "public/robots.txt",
      "src/app/sitemap.ts",
      "public/llms.txt",
    ]);
    expect(files).toEqual({
      robots: "public/robots.txt",
      sitemap: "src/app/sitemap.ts",
      llms: "public/llms.txt",
    });
    expect(findDiscoveryFiles(["README.md"])).toEqual({ robots: null, sitemap: null, llms: null });
  });

  it("builds a names-only inspection record", () => {
    const record = buildInspection({
      branch: "main",
      commitSha: "abc1234def",
      rootEntries: ["package.json", "src"],
      paths: ["package.json", "src/app/robots.ts"],
      truncated: false,
      pkg: { dependencies: { next: "16" } },
      now: new Date("2026-09-15T10:00:00Z"),
    });
    expect(record).toMatchObject({
      framework: "Next.js",
      discoveryFiles: { robots: "src/app/robots.ts" },
      commitSha: "abc1234def",
    });
    expect(JSON.stringify(record)).not.toContain("dependencies");
  });
});
