// api.server.ts — authenticated access to the GitHub REST API for the Mellox
// GitHub App. Tokens are minted and cached here, in server memory only:
//
//   App JWT            RS256, 9-minute lifetime, re-signed ~1 minute early
//   installation token 1-hour lifetime from GitHub, reused until 5 minutes
//                      before expiry, dropped on 401 and re-minted once
//
// Neither is ever persisted, logged, or returned to a caller outside this
// module. Callers get parsed JSON or a typed error.
import "server-only";
import { createSign } from "node:crypto";
import { fetchWithTimeout, UpstreamError } from "@/server/upstream";
import { requireGitHubConfig, type GitHubAppConfig } from "./config.server";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const TIMEOUT_MS = 15_000;

/** The installation is gone, suspended, or no longer grants this access. */
export class GitHubAccessError extends UpstreamError {
  constructor(
    readonly reason: "revoked" | "suspended" | "not_found" | "forbidden",
    message: string,
  ) {
    super(403, message, { provider: "github", code: reason });
    this.name = "GitHubAccessError";
  }
}

export class GitHubRateLimitError extends UpstreamError {
  constructor(readonly resetAt: string | null) {
    super(429, "GitHub's API rate limit was reached. Try again in a few minutes.", {
      provider: "github",
      code: "rate_limited",
    });
    this.name = "GitHubRateLimitError";
  }
}

/** GitHub refused the request as invalid or conflicting (e.g. the branch already exists). */
export class GitHubRequestError extends UpstreamError {
  constructor(
    readonly githubStatus: number,
    readonly githubMessage: string,
  ) {
    super(
      githubStatus === 409 ? 409 : 422,
      `GitHub rejected the request: ${githubMessage || githubStatus}`,
      {
        provider: "github",
        code: githubStatus === 409 ? "conflict" : "unprocessable",
      },
    );
    this.name = "GitHubRequestError";
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Sign a GitHub App JWT. Pure given the clock — exported for tests. */
export function signAppJwt(
  config: Pick<GitHubAppConfig, "appId" | "privateKey">,
  nowSeconds: number,
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat 60 s in the past tolerates clock drift; GitHub allows at most 10 minutes.
  const payload = base64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: config.appId }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(config.privateKey).toString("base64url")}`;
}

let appJwt: { token: string; expiresAt: number; appId: string } | null = null;

function getAppJwt(config: GitHubAppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  if (appJwt && appJwt.appId === config.appId && appJwt.expiresAt - 60 > now) return appJwt.token;
  const token = signAppJwt(config, now);
  appJwt = { token, expiresAt: now + 9 * 60, appId: config.appId };
  return token;
}

const installationTokens = new Map<string, { token: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string>>();

/** For tests and after a revocation. */
export function forgetInstallationToken(installationId: string): void {
  installationTokens.delete(installationId);
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Map a 404 to GitHubAccessError("not_found") instead of returning null. */
  notFoundIsAccessError?: boolean;
};

async function send(
  path: string,
  authorization: string,
  opts: RequestOptions = {},
): Promise<Response> {
  const url = path.startsWith("https://") ? path : `${API}${path}`;
  if (!url.startsWith(`${API}/`))
    throw new Error("Refusing to send GitHub credentials to another host");
  return fetchWithTimeout(
    url,
    {
      method: opts.method ?? "GET",
      headers: {
        authorization,
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": "Mellox-AI-GitHub-App",
        ...(opts.body ? { "content-type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      redirect: "error",
    },
    {
      timeoutMs: TIMEOUT_MS,
      onTransportError: (f) =>
        new UpstreamError(502, `GitHub is unreachable (${f.kind}).`, { provider: "github" }),
    },
  );
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { message?: string };
    return (json.message ?? "").slice(0, 200);
  } catch {
    return "";
  }
}

async function toError(res: Response): Promise<Error> {
  const message = await readError(res);
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (
    res.status === 429 ||
    (res.status === 403 && (remaining === "0" || /rate limit/i.test(message)))
  ) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    return new GitHubRateLimitError(
      Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
    );
  }
  if (res.status === 403 && /suspended/i.test(message)) {
    return new GitHubAccessError("suspended", "This GitHub installation is suspended.");
  }
  if (res.status === 401 || res.status === 403) {
    return new GitHubAccessError(
      "forbidden",
      "Mellox no longer has access to this GitHub resource.",
    );
  }
  if (res.status === 404) {
    return new GitHubAccessError(
      "not_found",
      "GitHub couldn't find that installation or repository.",
    );
  }
  if (res.status === 409 || res.status === 422) return new GitHubRequestError(res.status, message);
  return new UpstreamError(
    res.status >= 500 ? 502 : 400,
    `GitHub request failed (${res.status}).`,
    {
      provider: "github",
    },
  );
}

/** Request authenticated as the App itself (installation metadata). */
export async function appRequest<T>(path: string, opts: RequestOptions = {}): Promise<T | null> {
  const config = requireGitHubConfig();
  const res = await send(path, `Bearer ${getAppJwt(config)}`, opts);
  if (res.status === 204) return null;
  if (res.status === 404 && !opts.notFoundIsAccessError) return null;
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

async function mintInstallationToken(installationId: string): Promise<string> {
  const cachedToken = installationTokens.get(installationId);
  if (cachedToken && cachedToken.expiresAt - 5 * 60_000 > Date.now()) return cachedToken.token;
  const existing = inFlight.get(installationId);
  if (existing) return existing;
  const promise = (async () => {
    const config = requireGitHubConfig();
    const res = await send(
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      `Bearer ${getAppJwt(config)}`,
      { method: "POST" },
    );
    if (res.status === 404) {
      throw new GitHubAccessError("revoked", "The GitHub App was uninstalled from this account.");
    }
    if (!res.ok) throw await toError(res);
    const json = (await res.json()) as { token: string; expires_at: string };
    installationTokens.set(installationId, {
      token: json.token,
      expiresAt: Date.parse(json.expires_at),
    });
    return json.token;
  })().finally(() => inFlight.delete(installationId));
  inFlight.set(installationId, promise);
  return promise;
}

/** Request authenticated as an installation (repository access). Retries once after a stale token. */
export async function installationRequest<T>(
  installationId: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await mintInstallationToken(installationId);
    const res = await send(path, `token ${token}`, opts);
    if (res.status === 401 && attempt === 0) {
      forgetInstallationToken(installationId);
      continue;
    }
    if (res.status === 204) return null;
    if (res.status === 404 && !opts.notFoundIsAccessError) return null;
    if (!res.ok) throw await toError(res);
    return (await res.json()) as T;
  }
  throw new GitHubAccessError(
    "forbidden",
    "Mellox no longer has access to this GitHub installation.",
  );
}

/** Exchange an OAuth `code` (from the install callback) for a short-lived user token. */
export async function exchangeOAuthCode(code: string): Promise<string> {
  const config = requireGitHubConfig();
  if (!config.clientId || !config.clientSecret) throw new Error("GitHub OAuth is not configured");
  const res = await fetchWithTimeout(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
      }),
      redirect: "error",
    },
    {
      timeoutMs: TIMEOUT_MS,
      onTransportError: (f) =>
        new UpstreamError(502, `GitHub is unreachable (${f.kind}).`, { provider: "github" }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new GitHubAccessError(
      "forbidden",
      "GitHub didn't confirm your authorization. Start the connection again.",
    );
  }
  return json.access_token;
}

/** Whether the OAuth user can access `installationId` (paginates /user/installations). */
export async function userCanAccessInstallation(
  userToken: string,
  installationId: string,
): Promise<boolean> {
  for (let page = 1; page <= 10; page++) {
    const res = await send(`/user/installations?per_page=100&page=${page}`, `token ${userToken}`);
    if (!res.ok) throw await toError(res);
    const json = (await res.json()) as { installations?: { id: number }[] };
    const list = json.installations ?? [];
    if (list.some((i) => String(i.id) === installationId)) return true;
    if (list.length < 100) return false;
  }
  return false;
}
