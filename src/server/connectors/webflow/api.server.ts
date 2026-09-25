import "server-only";
import { fetchWithRetry, fetchWithTimeout, UpstreamError } from "@/server/upstream";

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

/**
 * One attempt, never retried: Webflow has no idempotency key, so a repeated
 * create makes a second item. Callers settle an unknown outcome by reading back.
 */
async function write<T>(
  path: string,
  token: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): Promise<T> {
  const response = await fetchWithTimeout(
    `${API}${path}`,
    {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    {
      timeoutMs: 30_000,
      onTransportError: (failure) => new WebflowApiError(502, `Webflow ${failure.kind}`),
    },
  );
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof json?.code === "string" ? json.code : undefined;
    const detail = typeof json?.message === "string" ? json.message.slice(0, 200) : "";
    const message =
      response.status === 401
        ? "Webflow authorization is invalid or expired."
        : response.status === 403
          ? "Webflow didn't allow this change. Reconnect Webflow and allow Mellox to edit your site."
          : response.status === 429
            ? "Webflow rate limit reached. Try again in a minute."
            : `Webflow could not complete that change${detail ? `: ${detail}` : "."}`;
    throw new WebflowApiError(response.status, message, code);
  }
  return json as T;
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

export const getPage = (token: string, pageId: string) =>
  request<WebflowPage>(`/pages/${encodeURIComponent(pageId)}`, token);
export const getCollection = (token: string, collectionId: string) =>
  request<WebflowCollection>(`/collections/${encodeURIComponent(collectionId)}`, token);
export const listItemsPage = (token: string, collectionId: string, offset = 0) =>
  request<{
    items?: WebflowItem[];
    pagination?: { total?: number; offset?: number; limit?: number };
  }>(`/collections/${encodeURIComponent(collectionId)}/items?limit=100&offset=${offset}`, token);
export const getItem = (token: string, collectionId: string, itemId: string) =>
  request<WebflowItem>(
    `/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
    token,
  );

/** Page title, slug, SEO and Open Graph settings (pages:write). Goes live on the next site publish. */
export const updatePageSettings = (
  token: string,
  pageId: string,
  body: {
    title?: string;
    slug?: string;
    seo?: { title?: string; description?: string };
    openGraph?: {
      title?: string;
      description?: string;
      titleCopied?: boolean;
      descriptionCopied?: boolean;
    };
  },
) => write<WebflowPage>(`/pages/${encodeURIComponent(pageId)}`, token, "PUT", body);

export const createCollection = (
  token: string,
  siteId: string,
  body: {
    displayName: string;
    singularName: string;
    slug: string;
    fields?: Array<{ type: string; displayName: string; isRequired?: boolean; helpText?: string }>;
  },
) =>
  write<WebflowCollection>(`/sites/${encodeURIComponent(siteId)}/collections`, token, "POST", body);

export const createCollectionField = (
  token: string,
  collectionId: string,
  body: { type: string; displayName: string; isRequired?: boolean; helpText?: string },
) =>
  write<WebflowField>(
    `/collections/${encodeURIComponent(collectionId)}/fields`,
    token,
    "POST",
    body,
  );

/** Create an item and publish it live in one call (cms:write). */
export const createItemLive = (
  token: string,
  collectionId: string,
  fieldData: Record<string, unknown>,
) =>
  write<WebflowItem>(`/collections/${encodeURIComponent(collectionId)}/items/live`, token, "POST", {
    isArchived: false,
    isDraft: false,
    fieldData,
  });

export const updateItemLive = (
  token: string,
  collectionId: string,
  itemId: string,
  fieldData: Record<string, unknown>,
) =>
  write<WebflowItem>(
    `/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}/live`,
    token,
    "PATCH",
    { isArchived: false, isDraft: false, fieldData },
  );

/**
 * Publish the site (sites:write). Webflow publishes every staged change, not
 * only Mellox's — the UI says so before anyone approves.
 */
export const publishSite = (
  token: string,
  siteId: string,
  body: { customDomains?: string[]; publishToWebflowSubdomain?: boolean },
) =>
  write<{ customDomains?: unknown[]; publishToWebflowSubdomain?: boolean }>(
    `/sites/${encodeURIComponent(siteId)}/publish`,
    token,
    "POST",
    body,
  );

export type WebflowSite = {
  id: string;
  displayName?: string;
  shortName?: string;
  customDomains?: Array<{ id?: string; url?: string | null }>;
  previewUrl?: string | null;
  lastPublished?: string | null;
};
export type WebflowPage = {
  id: string;
  siteId?: string;
  title?: string;
  slug?: string;
  publishedPath?: string;
  collectionId?: string | null;
  draft?: boolean;
  archived?: boolean;
  lastUpdated?: string;
  seo?: { title?: string | null; description?: string | null };
  openGraph?: {
    title?: string | null;
    titleCopied?: boolean;
    description?: string | null;
    descriptionCopied?: boolean;
  };
};
export type WebflowField = {
  id: string;
  type: string;
  slug: string;
  displayName: string;
  isRequired?: boolean;
};
export type WebflowCollection = {
  id: string;
  displayName?: string;
  slug?: string;
  singularName?: string;
  fields?: WebflowField[];
};
export type WebflowItem = {
  id: string;
  cmsLocaleId?: string;
  lastPublished?: string | null;
  lastUpdated?: string;
  isDraft?: boolean;
  isArchived?: boolean;
  fieldData: Record<string, unknown> & { name?: string; slug?: string };
};
