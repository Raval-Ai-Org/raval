import "server-only";
import { fetchWithRetry, fetchWithTimeout, UpstreamError } from "@/server/upstream";
import { assertPublicUrl } from "@/server/safe-fetch";
import { WORDPRESS_API_ENDPOINT, WORDPRESS_TOKEN_ENDPOINT } from "./config.server";

export type WordPressSite = {
  name?: string;
  description?: string;
  url?: string;
  home?: string;
  gmt_offset?: number;
  timezone_string?: string;
  namespaces?: string[];
};

export type WordPressUser = {
  id: number;
  name?: string;
  slug?: string;
  url?: string;
  link?: string;
  roles?: string[];
};

export class WordPressApiError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "wordpress", code });
    this.name = "WordPressApiError";
  }
}

export type WordPressComTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

export async function exchangeWordPressCode(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<WordPressComTokenSet> {
  const response = await fetchWithRetry(
    WORDPRESS_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        code: args.code,
        redirect_uri: args.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 2,
      onTransportError: (failure) =>
        new WordPressApiError(502, `WordPress.com OAuth ${failure.kind}.`),
    },
  );
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || typeof body?.access_token !== "string")
    throw new WordPressApiError(
      response.status >= 400 ? response.status : 502,
      "WordPress.com authorization could not be completed.",
    );
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt:
      typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export async function refreshWordPressToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<WordPressComTokenSet> {
  const response = await fetchWithRetry(
    WORDPRESS_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        refresh_token: args.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 1,
      onTransportError: (failure) =>
        new WordPressApiError(502, `WordPress.com OAuth ${failure.kind}.`),
    },
  );
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || typeof body?.access_token !== "string")
    throw new WordPressApiError(
      response.status === 401 ? 409 : 502,
      "WordPress.com authorization needs to be renewed.",
    );
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : args.refreshToken,
    expiresAt:
      typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
  };
}

async function wordpressComRequest<T>(path: string, token: string): Promise<T> {
  const response = await fetchWithRetry(
    `${WORDPRESS_API_ENDPOINT}${path}`,
    {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 2,
      onTransportError: (failure) => new WordPressApiError(502, `WordPress.com ${failure.kind}.`),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new WordPressApiError(
      response.status,
      response.status === 401
        ? "WordPress.com authorization is invalid or expired."
        : response.status === 403
          ? "WordPress.com denied this request."
          : "WordPress.com could not complete that request.",
    );
  return body as T;
}

export type WordPressComSite = {
  ID: number;
  name?: string;
  URL?: string;
  description?: string;
  visible?: boolean;
};
export type WordPressComUser = { ID?: number; username?: string; display_name?: string };
export const getWordPressComUser = (token: string) =>
  wordpressComRequest<WordPressComUser>("/rest/v1.1/me", token);
export const listWordPressComSites = (token: string) =>
  wordpressComRequest<{ sites?: WordPressComSite[] }>("/rest/v1.1/me/sites", token);
export const listWordPressComPosts = (token: string, siteId: number) =>
  wordpressComRequest<unknown[]>(`/rest/v1.1/sites/${siteId}/posts/?number=100`, token);
export const listWordPressComPages = (token: string, siteId: number) =>
  wordpressComRequest<unknown[]>(`/rest/v1.1/sites/${siteId}/pages/?number=100`, token);
export const listWordPressComMedia = (token: string, siteId: number) =>
  wordpressComRequest<unknown[]>(`/rest/v1.1/sites/${siteId}/media/?number=100`, token);

export function normalizeWordPressUrl(raw: string): string {
  const url = assertPublicUrl(raw.trim());
  if (url.protocol !== "https:")
    throw new WordPressApiError(400, "WordPress sites must use HTTPS.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function endpoint(siteUrl: string, path: string): string {
  const base = new URL(`${normalizeWordPressUrl(siteUrl)}/wp-json/`);
  const cleanPath = path.replace(/^\/+/, "");
  return new URL(cleanPath, base).toString();
}

function authorization(username: string, applicationPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${applicationPassword}`, "utf8").toString("base64")}`;
}

async function request<T>(
  siteUrl: string,
  username: string,
  applicationPassword: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = {
    accept: "application/json",
    authorization: authorization(username, applicationPassword),
    ...init.headers,
  };
  const response =
    init.method && init.method !== "GET"
      ? await fetchWithTimeout(
          endpoint(siteUrl, path),
          { ...init, headers, cache: "no-store" },
          {
            timeoutMs: 15_000,
            onTransportError: (failure) => new WordPressApiError(502, `WordPress ${failure.kind}.`),
          },
        )
      : await fetchWithRetry(
          endpoint(siteUrl, path),
          { ...init, headers, cache: "no-store" },
          {
            timeoutMs: 15_000,
            retries: 2,
            onTransportError: (failure) => new WordPressApiError(502, `WordPress ${failure.kind}.`),
          },
        );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : undefined;
    const detail = typeof body?.message === "string" ? body.message.slice(0, 160) : "";
    const message =
      response.status === 401
        ? "WordPress rejected these credentials."
        : response.status === 403
          ? "WordPress denied this operation for the connected account."
          : response.status === 404
            ? "The WordPress REST API endpoint was not found."
            : response.status === 429
              ? "WordPress rate limit reached. Try again shortly."
              : `WordPress could not complete that request${detail ? `: ${detail}` : "."}`;
    throw new WordPressApiError(response.status, message, code);
  }
  return body as T;
}

export const discover = (siteUrl: string, username: string, password: string) =>
  request<WordPressSite>(siteUrl, username, password, "");

export const getCurrentUser = (siteUrl: string, username: string, password: string) =>
  request<WordPressUser>(siteUrl, username, password, "wp/v2/users/me");

export const listPosts = (siteUrl: string, username: string, password: string, query = "") =>
  request<unknown[]>(siteUrl, username, password, `wp/v2/posts${query ? `?${query}` : ""}`);

export const listPages = (siteUrl: string, username: string, password: string, query = "") =>
  request<unknown[]>(siteUrl, username, password, `wp/v2/pages${query ? `?${query}` : ""}`);

export const listMedia = (siteUrl: string, username: string, password: string, query = "") =>
  request<unknown[]>(siteUrl, username, password, `wp/v2/media${query ? `?${query}` : ""}`);

export const listCategories = (siteUrl: string, username: string, password: string) =>
  request<unknown[]>(siteUrl, username, password, "wp/v2/categories");

export const listTags = (siteUrl: string, username: string, password: string) =>
  request<unknown[]>(siteUrl, username, password, "wp/v2/tags");

export const createPost = (siteUrl: string, username: string, password: string, body: unknown) =>
  request<unknown>(siteUrl, username, password, "wp/v2/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const updatePost = (
  siteUrl: string,
  username: string,
  password: string,
  id: number,
  body: unknown,
) =>
  request<unknown>(siteUrl, username, password, `wp/v2/posts/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const createPage = (siteUrl: string, username: string, password: string, body: unknown) =>
  request<unknown>(siteUrl, username, password, "wp/v2/pages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const updatePage = (
  siteUrl: string,
  username: string,
  password: string,
  id: number,
  body: unknown,
) =>
  request<unknown>(siteUrl, username, password, `wp/v2/pages/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export async function uploadMedia(
  siteUrl: string,
  username: string,
  password: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
) {
  return request<unknown>(siteUrl, username, password, "wp/v2/media", {
    method: "POST",
    headers: {
      "content-disposition": `attachment; filename="${filename.replace(/["\\\r\n]/g, "")}"`,
      "content-type": contentType,
    },
    body: bytes as BodyInit,
  });
}
