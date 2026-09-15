// config.server.ts — GitHub App configuration, read from the server
// environment only. Nothing here may be imported by browser code.
import "server-only";
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";

export type InstallVerificationMode = "oauth" | "install_window" | "unavailable";
export type GitHubConfigurationErrorCode =
  | "missing_variable"
  | "invalid_private_key"
  | "invalid_app_id"
  | "invalid_app_slug"
  | "verification_unavailable";

export type GitHubDiagnostic = {
  appIdPresent: boolean;
  appSlugPresent: boolean;
  appNamePresent: boolean;
  privateKeyPresent: boolean;
  privateKeyValid: boolean;
  webhookSecretPresent: boolean;
  clientIdPresent: boolean;
  clientSecretPresent: boolean;
  appUrlPresent: boolean;
  appUrlHttps: boolean;
  callbackUrlValid: boolean;
  webhookUrlValid: boolean;
  appJwtGenerationValid: boolean;
  githubApiReachable: boolean;
  oauthConfigurationValid: boolean;
};

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
  constructor(
    readonly issues: string[],
    readonly code: GitHubConfigurationErrorCode = "missing_variable",
  ) {
    super(
      code === "verification_unavailable"
        ? "GitHub installation verification isn't configured for this server."
        : code === "invalid_private_key"
          ? "GitHub's private key is invalid on this server."
          : code === "invalid_app_id"
            ? "GitHub's App ID is invalid on this server."
            : code === "invalid_app_slug"
              ? "GitHub's App slug is invalid on this server."
              : "GitHub is not configured on this server.",
    );
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
  if (env.GITHUB_CLIENT_ID?.trim() && env.GITHUB_CLIENT_SECRET?.trim()) return "oauth";
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
  if (!/^[a-z0-9-]+$/i.test(slug)) issues.push("GITHUB_APP_SLUG is missing or invalid");

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

function appUrlState(env: Env): {
  present: boolean;
  https: boolean;
  callbackValid: boolean;
  webhookValid: boolean;
} {
  const raw = (env.APP_URL ?? "").trim();
  const present = Boolean(raw);
  try {
    const url = new URL(raw);
    const https =
      url.protocol === "https:" &&
      !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(url.hostname) &&
      !url.username &&
      !url.password;
    const callback = new URL("/api/integrations/github/callback", url);
    const webhook = new URL("/api/integrations/github/webhook", url);
    const validPath = (candidate: URL, path: string) =>
      candidate.href === `${url.origin}${path}` && candidate.protocol === "https:";
    return {
      present,
      https,
      callbackValid: https && validPath(callback, "/api/integrations/github/callback"),
      webhookValid: https && validPath(webhook, "/api/integrations/github/webhook"),
    };
  } catch {
    return { present, https: false, callbackValid: false, webhookValid: false };
  }
}

/** A secret-free local diagnostic. API authentication is filled by the API probe. */
export function getGitHubDiagnostic(env: Env = process.env): GitHubDiagnostic {
  const rawAppId = (env.GITHUB_APP_ID ?? "").trim();
  const rawSlug = (env.GITHUB_APP_SLUG ?? "").trim();
  const rawName = (env.GITHUB_APP_NAME ?? "").trim();
  const rawPrivateKey = (env.GITHUB_APP_PRIVATE_KEY ?? "").trim();
  const rawWebhookSecret = (env.GITHUB_WEBHOOK_SECRET ?? "").trim();
  const rawClientId = (env.GITHUB_CLIENT_ID ?? "").trim();
  const rawClientSecret = (env.GITHUB_CLIENT_SECRET ?? "").trim();
  const urls = appUrlState(env);
  const pem = normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  let privateKeyValid = false;
  let appJwtGenerationValid = false;
  if (pem) {
    try {
      const key = createPrivateKey(pem);
      privateKeyValid = key.asymmetricKeyType === "rsa";
      if (privateKeyValid && /^\d+$/.test(rawAppId)) {
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
          "base64url",
        );
        const payload = Buffer.from(
          JSON.stringify({ iat: now - 60, exp: now + 540, iss: Number(rawAppId) }),
        ).toString("base64url");
        const signer = createSign("RSA-SHA256");
        signer.update(`${header}.${payload}`);
        appJwtGenerationValid = signer.sign(key).length > 0;
      }
    } catch {
      privateKeyValid = false;
    }
  }
  return {
    appIdPresent: /^\d+$/.test(rawAppId),
    appSlugPresent: /^[a-z0-9-]+$/i.test(rawSlug),
    appNamePresent: Boolean(rawName),
    privateKeyPresent: Boolean(rawPrivateKey),
    privateKeyValid,
    webhookSecretPresent: Boolean(rawWebhookSecret),
    clientIdPresent: Boolean(rawClientId),
    clientSecretPresent: Boolean(rawClientSecret),
    appUrlPresent: urls.present,
    appUrlHttps: urls.https,
    callbackUrlValid: urls.callbackValid,
    webhookUrlValid: urls.webhookValid,
    appJwtGenerationValid,
    githubApiReachable: false,
    oauthConfigurationValid: false,
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

/**
 * Where an install flow may send the installer back to: this deployment's
 * public origins (APP_URL, NEXT_PUBLIC_APP_URL), GITHUB_ALLOWED_RETURN_ORIGINS
 * (comma-separated, e.g. a custom domain and the Railway domain), and — when
 * `allowLocal` — a localhost development server. Returns the normalized origin
 * or null. The GitHub App has a single callback URL; this lets that callback
 * hand the installer back to the origin that holds their Mellox session.
 */
export function allowedReturnOrigin(
  candidate: string | null | undefined,
  env: Env = process.env,
  opts: { allowLocal: boolean },
): string | null {
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) return opts.allowLocal ? url.origin : null;
  if (url.protocol !== "https:") return null;
  const allowed = [
    env.APP_URL,
    env.NEXT_PUBLIC_APP_URL,
    ...(env.GITHUB_ALLOWED_RETURN_ORIGINS ?? "").split(","),
  ].flatMap((raw) => {
    try {
      return raw?.trim() ? [new URL(raw.trim()).origin] : [];
    } catch {
      return [];
    }
  });
  return allowed.includes(url.origin) ? url.origin : null;
}

/**
 * The in-app page to return to after connecting: a same-origin relative path
 * (e.g. "/app?settings=connections"), or null when absent or unsafe.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/\p{Cc}/u.test(value)) return null;
  const base = "https://return-path.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function requireGitHubConfig(): GitHubAppConfig {
  const check = getGitHubConfigCheck();
  if (!check.ok) {
    const code: GitHubConfigurationErrorCode = check.issues.some((issue) =>
      issue.includes("GITHUB_APP_PRIVATE_KEY"),
    )
      ? "invalid_private_key"
      : check.issues.some((issue) => issue.includes("GITHUB_APP_ID"))
        ? "invalid_app_id"
        : check.issues.some((issue) => issue.includes("GITHUB_APP_SLUG"))
          ? "invalid_app_slug"
          : "missing_variable";
    throw new GitHubNotConfiguredError(check.issues, code);
  }
  return check.config;
}
