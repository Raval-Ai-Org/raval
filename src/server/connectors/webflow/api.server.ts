import "server-only";
import { fetchWithRetry, UpstreamError } from "@/server/upstream";

const API = "https://api.webflow.com/v2";
const TOKEN = "https://api.webflow.com/oauth/access_token";
const REVOKE = "https://webflow.com/oauth/revoke_authorization";

export class WebflowApiError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "webflow", code });
    this.name = "WebflowApiError";
  }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithRetry(
    `${API}${path}`,
    {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 2,
      onTransportError: (failure) => new WebflowApiError(502, `Webflow ${failure.kind}`),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : undefined;
    const message =
      response.status === 401
        ? "Webflow authorization is invalid or expired."
        : response.status === 403
          ? "Webflow denied this request. Check the granted permissions."
          : response.status === 429
            ? "Webflow rate limit reached. Try again shortly."
            : "Webflow could not complete that request.";
    throw new WebflowApiError(response.status, message, code);
  }
  return body as T;
}

export type WebflowTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

export async function exchangeCode(code: string): Promise<WebflowTokenSet> {
  const { requireWebflowConfig } = await import("./config.server");
  const config = requireWebflowConfig();
  const response = await fetchWithRetry(
    TOKEN,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      }),
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 2,
      onTransportError: (failure) => new WebflowApiError(502, `Webflow OAuth ${failure.kind}`),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.access_token !== "string") {
    const code = typeof body?.code === "string" ? body.code : undefined;
    const status = response.status >= 400 ? response.status : 502;
    throw new WebflowApiError(
      status,
      code
        ? `Webflow authorization could not be completed (${code}).`
        : "Webflow authorization could not be completed.",
      code,
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt:
      typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export async function refreshAccess(refreshToken: string): Promise<WebflowTokenSet> {
  const { requireWebflowConfig } = await import("./config.server");
  const config = requireWebflowConfig();
  const response = await fetchWithRetry(
    TOKEN,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 1,
      onTransportError: (failure) => new WebflowApiError(502, `Webflow OAuth ${failure.kind}`),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.access_token !== "string")
    throw new WebflowApiError(
      response.status === 401 ? 409 : 502,
      "Webflow authorization needs to be renewed.",
    );
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : refreshToken,
    expiresAt:
      typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export async function revokeAccess(accessToken: string): Promise<void> {
  const { requireWebflowConfig } = await import("./config.server");
  const config = requireWebflowConfig();
  await fetchWithRetry(
    REVOKE,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        access_token: accessToken,
      }),
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 1,
      onTransportError: (failure) => new WebflowApiError(502, `Webflow revoke ${failure.kind}`),
    },
  );
}

export const getTokenUser = (token: string) =>
  request<{ id?: string; email?: string; firstName?: string; lastName?: string }>(
    "/token/authorized_by",
    token,
  );
export const listSites = (token: string) => request<{ sites?: WebflowSite[] }>("/sites", token);
export const getSite = (token: string, siteId: string) =>
  request<WebflowSite>(`/sites/${encodeURIComponent(siteId)}`, token);
export const listPages = (token: string, siteId: string) =>
  request<{ pages?: WebflowPage[]; pagination?: unknown }>(
    `/sites/${encodeURIComponent(siteId)}/pages?limit=100`,
    token,
  );
export const listCollections = (token: string, siteId: string) =>
  request<{ collections?: WebflowCollection[] }>(
    `/sites/${encodeURIComponent(siteId)}/collections`,
    token,
  );
export const listItems = (token: string, collectionId: string) =>
  request<{ items?: unknown[]; pagination?: unknown }>(
    `/collections/${encodeURIComponent(collectionId)}/items?limit=100`,
    token,
  );

export type WebflowSite = {
  id: string;
  displayName?: string;
  customDomains?: Array<{ url?: string | null }>;
  previewUrl?: string | null;
};
export type WebflowPage = {
  id: string;
  title?: string;
  slug?: string;
  publishedPath?: string;
  seo?: { title?: string; description?: string };
};
export type WebflowCollection = {
  id: string;
  displayName?: string;
  slug?: string;
  singularName?: string;
};
