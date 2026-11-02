import "server-only";
// api.server.ts — the only file that talks to Wix's REST API.
//
// Auth: Wix apps get a 4-hour access token from the app id + secret and the
// site's app instance id (client credentials). There is no refresh token and
// no user consent per call; the instance id is the lasting credential.
// Reads are retried; writes are one attempt each (Wix has no idempotency key,
// so a repeated create makes a second post). Callers settle an unknown
// outcome by reading back.
import { fetchWithRetry, fetchWithTimeout, UpstreamError } from "@/server/upstream";
import type { WixSeoTag } from "@/lib/sites/wix-seo";
import type { RicosDocument } from "@/lib/articles/wix-ricos";

const API = "https://www.wixapis.com";

export class WixApiError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "wix", code });
    this.name = "WixApiError";
  }
}

function failure(status: number, body: any, writing: boolean): WixApiError {
  const code =
    typeof body?.details?.applicationError?.code === "string"
      ? body.details.applicationError.code
      : typeof body?.code === "string"
        ? body.code
        : undefined;
  const detail = typeof body?.message === "string" ? body.message.slice(0, 200) : "";
  const message =
    status === 401
      ? "Wix sign-in for this site has expired. Connect Wix again."
      : status === 403
        ? writing
          ? "Wix didn't allow this change. Connect Wix again and allow Mellox to edit your site."
          : "Wix denied this request. Check the permissions Mellox was given."
        : status === 404
          ? "Wix couldn't find that."
          : status === 429
            ? "Wix is busy. Try again in a minute."
            : `Wix couldn't complete that${detail ? `: ${detail}` : "."}`;
  return new WixApiError(status, message, code);
}

async function read<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithRetry(
    `${API}${path}`,
    {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: token,
        ...init.headers,
      },
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 2,
      onTransportError: (f) => new WixApiError(502, `Wix ${f.kind}`),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) throw failure(response.status, body, false);
  return body as T;
}

async function write<T>(
  path: string,
  token: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const response = await fetchWithTimeout(
    `${API}${path}`,
    {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: token,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    {
      timeoutMs: 30_000,
      onTransportError: (f) => new WixApiError(502, `Wix ${f.kind}`),
    },
  );
  const json = await response.json().catch(() => null);
  if (!response.ok) throw failure(response.status, json, true);
  return json as T;
}

/* ───────────────────────── auth ───────────────────────── */

export type WixAccessToken = { accessToken: string; expiresAt: Date };

/** A fresh access token for one app instance (client credentials). */
export async function createAccessToken(instanceId: string): Promise<WixAccessToken> {
  const { requireWixConfig } = await import("./config.server");
  const config = requireWixConfig();
  const response = await fetchWithRetry(
    `${API}/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.appId,
        client_secret: config.appSecret,
        instance_id: instanceId,
      }),
      cache: "no-store",
    },
    {
      timeoutMs: 15_000,
      retries: 1,
      onTransportError: (f) => new WixApiError(502, `Wix sign-in ${f.kind}`),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.access_token !== "string") {
    // 4xx: the app was removed from the site, or the instance is wrong.
    throw new WixApiError(
      response.status >= 400 && response.status < 500 ? 409 : 502,
      "Wix sign-in for this site has expired. Connect Wix again.",
    );
  }
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 4 * 3600;
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + seconds * 1000) };
}

/* ───────────────────────── app instance ───────────────────────── */

export type WixAppInstance = {
  instance?: { instanceId?: string; appName?: string; permissions?: string[] };
  site?: {
    siteDisplayName?: string;
    url?: string;
    siteId?: string;
    locale?: string;
    installedWixApps?: string[];
    ownerInfo?: { email?: string };
  };
};

export const getAppInstance = (token: string) => read<WixAppInstance>("/apps/v1/instance", token);

/* ───────────────────────── blog ───────────────────────── */

export type WixPost = {
  id: string;
  title?: string;
  slug?: string;
  memberId?: string;
  url?: { base?: string; path?: string };
  firstPublishedDate?: string;
  lastPublishedDate?: string;
};

export type WixDraftPost = { id: string; title?: string; seoSlug?: string; status?: string };

/** Newest published posts (Read Blog). A missing Wix Blog app answers 4xx. */
export const listPosts = (token: string, limit = 5) =>
  read<{ posts?: WixPost[] }>(
    `/blog/v3/posts?paging.limit=${limit}&sort=PUBLISHED_DATE_DESC&fieldsets=URL`,
    token,
  );

/** A published post by its slug, or null (Read Blog). */
export async function getPostBySlug(token: string, slug: string): Promise<WixPost | null> {
  try {
    const r = await read<{ post?: WixPost }>(
      `/blog/v3/posts/slugs/${encodeURIComponent(slug)}?fieldsets=URL`,
      token,
    );
    return r.post ?? null;
  } catch (error) {
    if (error instanceof WixApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Create a post and publish it in the same call (Manage Blog), so an
 * interrupted call is found again by slug. Never retried.
 */
export const createPublishedPost = (
  token: string,
  draftPost: {
    title: string;
    memberId: string;
    excerpt?: string;
    seoSlug: string;
    hashtags?: string[];
    richContent: RicosDocument;
    seoData?: { tags: WixSeoTag[] };
    language?: string;
  },
) =>
  write<{ draftPost?: WixDraftPost }>("/blog/v3/draft-posts", token, "POST", {
    draftPost,
    publish: true,
  });

/** Publish a draft again; if it was published already, the post takes the draft's values. */
export const publishDraft = (token: string, draftId: string) =>
  write<{ postId?: string }>(
    `/blog/v3/draft-posts/${encodeURIComponent(draftId)}/publish`,
    token,
    "POST",
    {},
  );

/* ───────────────────────── members ───────────────────────── */

export const findMemberByEmail = (token: string, email: string) =>
  read<{ members?: { id: string }[] }>("/members/v1/members/query", token, {
    method: "POST",
    body: JSON.stringify({ query: { filter: { loginEmail: email }, paging: { limit: 1 } } }),
  });

/* ───────────────────────── SEO tags ───────────────────────── */

export type WixItemType = "STATIC_PAGE" | "BLOG_POST";

export type WixResolvedTag = { tag: WixSeoTag; source?: string };

export type WixItemSeoTags = {
  itemType?: string;
  itemId?: string;
  tags?: WixSeoTag[];
  resolvedTags?: WixResolvedTag[];
  hasOverride?: boolean;
};

const seoPath = (type: WixItemType, id?: string) =>
  `/promote/seo/v1/item-seo-tags/${type}${id ? `/${encodeURIComponent(id)}` : ""}`;

export async function getItemSeoTags(token: string, type: WixItemType, id: string) {
  const r = await read<{ itemSeoTags?: WixItemSeoTags }>(seoPath(type, id), token);
  return r.itemSeoTags ?? {};
}

/** The first 100 items of a type with what they render (used to find a static page by URL). */
export async function listItemSeoTags(token: string, type: WixItemType) {
  const r = await read<{ itemSeoTags?: WixItemSeoTags[] }>(
    `${seoPath(type)}?paging.limit=100`,
    token,
  );
  return r.itemSeoTags ?? [];
}

/**
 * Replace an item's own tags (Manage SEO Settings). Wix has no partial update:
 * callers always read, merge and send the complete set. `publish: true`
 * writes a static page's published revision; without it, its draft.
 */
export const setItemSeoTags = (
  token: string,
  type: WixItemType,
  id: string,
  tags: WixSeoTag[],
  publish: boolean,
) =>
  write<{ itemSeoTags?: WixItemSeoTags }>(seoPath(type, id), token, "PATCH", {
    itemSeoTags: { tags },
    fieldMask: "tags",
    publish,
  });
