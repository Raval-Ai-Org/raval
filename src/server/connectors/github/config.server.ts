// config.server.ts — GitHub App configuration, read from the server
// environment only. Nothing here may be imported by browser code.
import "server-only";
import { createPrivateKey, type KeyObject } from "node:crypto";

export type InstallVerificationMode = "oauth" | "install_window" | "unavailable";

export type GitHubAppConfig = {
  appId: string;
  slug: string;
  name: string;
  clientId: string | null;
  clientSecret: string | null;
  webhookSecret: string | null;
  privateKey: KeyObject;
  /** How a returning installer is proven to control the installation. */
  installVerification: InstallVerificationMode;
};

export class GitHubNotConfiguredError extends Error {
  constructor(readonly issues: string[]) {
    super("GitHub isn't configured on this server yet.");
    this.name = "GitHubNotConfiguredError";
  }
}

type Env = Record<string, string | undefined>;

/**
 * Accept the private key the ways deployment platforms mangle it: real
 * newlines, literal "\n" sequences (single-line env vars), surrounding quotes,
 * or the whole PEM base64-encoded.
 */
export function normalizePrivateKey(raw: string | undefined): string | null {
  if (!raw) return null;
  let key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key.includes("BEGIN") && /^[A-Za-z0-9+/=\s]+$/.test(key)) {
    try {
      const decoded = Buffer.from(key, "base64").toString("utf8");
      if (decoded.includes("BEGIN")) key = decoded;
    } catch {
      /* not base64 */
    }
  }
  key = key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/.test(key)
    ? key
    : null;
}

/**
 * Production proves installers with GitHub OAuth (needs the client secret and
 * "Request user authorization (OAuth) during installation" on the App). The
 * weaker install-window check is only used in development, or when explicitly
 * allowed with GITHUB_INSTALL_VERIFICATION=install_window.
 */
export function resolveInstallVerification(env: Env): InstallVerificationMode {
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) return "oauth";
  const explicit = (env.GITHUB_INSTALL_VERIFICATION ?? "").trim().toLowerCase();
  if (explicit === "install_window") return "install_window";
  return env.NODE_ENV === "production" ? "unavailable" : "install_window";
}

export type ConfigCheck =
  { ok: true; config: GitHubAppConfig; issues: string[] } | { ok: false; issues: string[] };

/** Validate the environment. Pure (given env) — exported for tests. Never echoes values. */
export function checkGitHubConfig(env: Env): ConfigCheck {
  const issues: string[] = [];
  const appId = (env.GITHUB_APP_ID ?? "").trim();
  const slug = (env.GITHUB_APP_SLUG ?? "").trim();
  if (!/^\d+$/.test(appId)) issues.push("GITHUB_APP_ID is missing or not numeric");
  if (!/^[a-z0-9-]+$/i.test(slug)) issues.push("GITHUB_APP_SLUG is missing");

  const pem = normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  let privateKey: KeyObject | null = null;
  if (!pem) {
    issues.push("GITHUB_APP_PRIVATE_KEY is missing or not a PEM private key");
  } else {
    try {
      privateKey = createPrivateKey(pem);
      if (privateKey.asymmetricKeyType !== "rsa") {
        issues.push("GITHUB_APP_PRIVATE_KEY is not an RSA key");
        privateKey = null;
      }
    } catch {
      issues.push("GITHUB_APP_PRIVATE_KEY could not be parsed");
    }
  }

  const webhookSecret = (env.GITHUB_WEBHOOK_SECRET ?? "").trim() || null;
  const warnings: string[] = [];
  if (!webhookSecret) warnings.push("GITHUB_WEBHOOK_SECRET is not set — webhooks will be rejected");
  const installVerification = resolveInstallVerification(env);
  if (installVerification === "unavailable") {
    warnings.push(
      "GITHUB_CLIENT_SECRET is not set — installs can't be verified in production (enable OAuth during installation on the GitHub App)",
    );
  } else if (installVerification === "install_window") {
    warnings.push(
      "Installs are verified by install timing, not GitHub OAuth — set GITHUB_CLIENT_SECRET",
    );
  }

  if (issues.length || !privateKey) return { ok: false, issues: [...issues, ...warnings] };
  return {
    ok: true,
    issues: warnings,
    config: {
      appId,
      slug,
      name: (env.GITHUB_APP_NAME ?? "").trim() || slug,
      clientId: (env.GITHUB_CLIENT_ID ?? "").trim() || null,
      clientSecret: (env.GITHUB_CLIENT_SECRET ?? "").trim() || null,
      webhookSecret,
      privateKey,
      installVerification,
    },
  };
}

let cached: { signature: string; result: ConfigCheck } | null = null;

/** Current config; re-validated when the relevant env vars change (tests, hot reload). */
export function getGitHubConfigCheck(env: Env = process.env): ConfigCheck {
  const signature = [
    env.GITHUB_APP_ID,
    env.GITHUB_APP_SLUG,
    env.GITHUB_APP_PRIVATE_KEY?.length,
    env.GITHUB_WEBHOOK_SECRET?.length,
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET?.length,
    env.GITHUB_INSTALL_VERIFICATION,
    env.NODE_ENV,
  ].join("|");
  if (cached?.signature !== signature) cached = { signature, result: checkGitHubConfig(env) };
  return cached.result;
}

export function requireGitHubConfig(): GitHubAppConfig {
  const check = getGitHubConfigCheck();
  if (!check.ok) throw new GitHubNotConfiguredError(check.issues);
  return check.config;
}
