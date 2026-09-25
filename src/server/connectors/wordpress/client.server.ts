import "server-only";
// client.server.ts — one WordPress REST client for both kinds of connection.
//
//   self-hosted     https://site/wp-json/<ns>/<ver>/<route>   Basic (Application Password)
//   WordPress.com   https://public-api.wordpress.com/<ns>/<ver>/sites/<id>/<route>   Bearer
//
// Everything that changes a site (GEO fixes, articles, blog setup) goes through
// here, so a WordPress.com connection can write exactly like a self-hosted one.
// Writes are never retried: an unknown outcome is settled by reading back
// (findBySlug / getObject), because a repeated POST creates a second post.
import { fetchWithRetry, fetchWithTimeout } from "@/server/upstream";
import { WordPressApiError, normalizeWordPressUrl } from "./api.server";
import { WORDPRESS_API_ENDPOINT } from "./config.server";

export type WordPressAuth =
  | { kind: "basic"; siteUrl: string; username: string; password: string }
  | { kind: "bearer"; siteUrl: string; siteId: number; token: string };

export type WordPressObjectType = "post" | "page";

export type WordPressObject = {
  id: number;
  type: WordPressObjectType;
  link: string;
  slug: string;
  status: string;
  title: string;
  content: string;
  excerpt: string;
  meta: Record<string, unknown>;
  featuredMedia: number | null;
  modified: string | null;
};

export type WordPressSettings = {
  title?: string;
  description?: string;
  url?: string;
  show_on_front?: "posts" | "page";
  page_on_front?: number;
  page_for_posts?: number;
  default_category?: number;
  timezone?: string;
};

const collection = (type: WordPressObjectType) => (type === "post" ? "posts" : "pages");

function rendered(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as { raw?: unknown; rendered?: unknown };
    if (typeof v.raw === "string") return v.raw;
    if (typeof v.rendered === "string") return v.rendered;
  }
  return "";
}

export function toObject(type: WordPressObjectType, raw: Record<string, unknown>): WordPressObject {
  return {
    id: Number(raw.id),
    type,
    link: typeof raw.link === "string" ? raw.link : "",
    slug: typeof raw.slug === "string" ? raw.slug : "",
    status: typeof raw.status === "string" ? raw.status : "",
    title: rendered(raw.title),
    content: rendered(raw.content),
    excerpt: rendered(raw.excerpt),
    meta: raw.meta && typeof raw.meta === "object" ? (raw.meta as Record<string, unknown>) : {},
    featuredMedia:
      typeof raw.featured_media === "number" && raw.featured_media > 0 ? raw.featured_media : null,
    modified: typeof raw.modified_gmt === "string" ? raw.modified_gmt : null,
  };
}

/** `<ns>/<ver>/<route>` → the absolute URL for this connection. */
export function wordpressUrl(auth: WordPressAuth, path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (auth.kind === "basic") {
    return new URL(clean, `${normalizeWordPressUrl(auth.siteUrl)}/wp-json/`).toString();
  }
  const m = /^([a-z0-9-]+)\/(v\d+)\/?(.*)$/i.exec(clean);
  if (!m) throw new WordPressApiError(400, "Unsupported WordPress.com API path.");
  const [, ns, ver, rest] = m;
  return `${WORDPRESS_API_ENDPOINT}/${ns}/${ver}/sites/${auth.siteId}/${rest}`;
}

function authorization(auth: WordPressAuth): string {
  return auth.kind === "basic"
    ? `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")}`
    : `Bearer ${auth.token}`;
}

function describeFailure(status: number, body: unknown): string {
  const detail =
    body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? String((body as { message: string }).message).slice(0, 160)
      : "";
  if (status === 401) return "WordPress rejected Mellox's access. Reconnect WordPress.";
  if (status === 403)
    return `WordPress didn't allow this for the connected account${detail ? `: ${detail}` : "."}`;
  if (status === 404) return "WordPress couldn't find that item or endpoint.";
  if (status === 429) return "WordPress rate limit reached. Try again shortly.";
  return `WordPress could not complete that request${detail ? `: ${detail}` : "."}`;
}

export class WordPressClient {
  constructor(readonly auth: WordPressAuth) {}

  get siteUrl() {
    return this.auth.siteUrl.replace(/\/+$/, "");
  }

  get kind(): "self_hosted" | "wordpress_com" {
    return this.auth.kind === "basic" ? "self_hosted" : "wordpress_com";
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetchWithRetry(
      wordpressUrl(this.auth, path),
      {
        headers: { accept: "application/json", authorization: authorization(this.auth) },
        cache: "no-store",
      },
      {
        timeoutMs: 15_000,
        retries: 2,
        onTransportError: (f) => new WordPressApiError(502, `WordPress ${f.kind}.`),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (body as { code?: unknown } | null)?.code;
      throw new WordPressApiError(
        response.status,
        describeFailure(response.status, body),
        typeof code === "string" ? code : undefined,
      );
    }
    return body as T;
  }

  /** One attempt, never retried (see the header). */
  async send<T>(
    path: string,
    body: unknown,
    init: {
      method?: "POST" | "DELETE";
      raw?: { bytes: Uint8Array; headers: Record<string, string> };
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: authorization(this.auth),
      ...(init.raw ? init.raw.headers : { "content-type": "application/json" }),
    };
    const response = await fetchWithTimeout(
      wordpressUrl(this.auth, path),
      {
        method: init.method ?? "POST",
        headers,
        body: init.raw ? (init.raw.bytes as BodyInit) : JSON.stringify(body),
        cache: "no-store",
      },
      {
        timeoutMs: 30_000,
        onTransportError: (f) => new WordPressApiError(502, `WordPress ${f.kind}.`),
      },
    );
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (json as { code?: unknown } | null)?.code;
      throw new WordPressApiError(
        response.status,
        describeFailure(response.status, json),
        typeof code === "string" ? code : undefined,
      );
    }
    return json as T;
  }

  async getObject(type: WordPressObjectType, id: number): Promise<WordPressObject> {
    const raw = await this.get<Record<string, unknown>>(
      `wp/v2/${collection(type)}/${id}?context=edit`,
    );
    return toObject(type, raw);
  }

  async updateObject(
    type: WordPressObjectType,
    id: number,
    body: Record<string, unknown>,
  ): Promise<WordPressObject> {
    const raw = await this.send<Record<string, unknown>>(`wp/v2/${collection(type)}/${id}`, body);
    return toObject(type, raw);
  }

  async createObject(
    type: WordPressObjectType,
    body: Record<string, unknown>,
  ): Promise<WordPressObject> {
    const raw = await this.send<Record<string, unknown>>(`wp/v2/${collection(type)}`, body);
    return toObject(type, raw);
  }

  /** Any status, so a draft created by an interrupted call is found too. */
  async findBySlug(type: WordPressObjectType, slug: string): Promise<WordPressObject | null> {
    const list = await this.get<Record<string, unknown>[]>(
      `wp/v2/${collection(type)}?slug=${encodeURIComponent(slug)}&status=publish,draft,pending,future,private&context=edit`,
    );
    return Array.isArray(list) && list[0] ? toObject(type, list[0]) : null;
  }

  async listObjects(type: WordPressObjectType, perPage = 50): Promise<WordPressObject[]> {
    const list = await this.get<Record<string, unknown>[]>(
      `wp/v2/${collection(type)}?per_page=${Math.min(100, perPage)}&status=publish&_fields=id,link,slug,status,title,modified_gmt`,
    );
    return Array.isArray(list) ? list.map((r) => toObject(type, r)) : [];
  }

  getSettings(): Promise<WordPressSettings> {
    return this.get<WordPressSettings>("wp/v2/settings");
  }

  updateSettings(patch: Partial<WordPressSettings>): Promise<WordPressSettings> {
    return this.send<WordPressSettings>("wp/v2/settings", patch);
  }

  async ensureTerm(taxonomy: "categories" | "tags", name: string): Promise<number | null> {
    const clean = name.trim().slice(0, 80);
    if (!clean) return null;
    const found = await this.get<{ id: number; name: string }[]>(
      `wp/v2/${taxonomy}?search=${encodeURIComponent(clean)}&per_page=20`,
    );
    const exact = (found ?? []).find((t) => t.name.toLowerCase() === clean.toLowerCase());
    if (exact) return exact.id;
    try {
      const created = await this.send<{ id: number }>(`wp/v2/${taxonomy}`, { name: clean });
      return created.id;
    } catch (error) {
      // term_exists carries the existing id; anything else leaves the post uncategorised.
      const data = (error as { code?: string }).code;
      if (data === "term_exists") {
        const again = await this.get<{ id: number; name: string }[]>(
          `wp/v2/${taxonomy}?search=${encodeURIComponent(clean)}&per_page=20`,
        );
        return again.find((t) => t.name.toLowerCase() === clean.toLowerCase())?.id ?? null;
      }
      return null;
    }
  }

  async uploadMedia(args: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    altText?: string;
  }): Promise<{ id: number; url: string }> {
    const media = await this.send<{ id: number; source_url?: string }>("wp/v2/media", null, {
      raw: {
        bytes: args.bytes,
        headers: {
          "content-type": args.contentType,
          "content-disposition": `attachment; filename="${args.filename.replace(/["\\\r\n]/g, "")}"`,
        },
      },
    });
    if (args.altText) {
      await this.send(`wp/v2/media/${media.id}`, { alt_text: args.altText.slice(0, 250) }).catch(
        () => null,
      );
    }
    return { id: media.id, url: media.source_url ?? "" };
  }

  getMedia(id: number): Promise<{ id: number; alt_text: string; source_url: string }> {
    return this.get(`wp/v2/media/${id}?context=edit`);
  }

  updateMediaAlt(id: number, altText: string) {
    return this.send<{ id: number; alt_text: string }>(`wp/v2/media/${id}`, { alt_text: altText });
  }
}
