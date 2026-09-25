import "server-only";
// access.server.ts — read and write one field of a WordPress or Webflow object.
//
// The only place a CMS fix touches a site. Each field has one key per
// backend (the Mellox GEO plugin, Rank Math, Jetpack SEO, Webflow page
// settings, a CMS item's rich text). Reads return what the platform stores now,
// so an apply can refuse when the value changed since the person approved it
// (drift) and an undo can refuse when someone edited it after Mellox.
import type { CmsChange, CmsField, CmsTarget, WordPressSeoBackend } from "@/lib/geo/cms-fixes";
import { HttpError } from "@/server/http-error";
import type { WordPressClient } from "@/server/connectors/wordpress/client.server";
import type { WebflowSite } from "@/server/connectors/webflow/api.server";

export type CmsSession =
  | {
      provider: "wordpress";
      workspaceId: string;
      client: WordPressClient;
      seo: WordPressSeoBackend;
      siteUrl: string;
    }
  | {
      provider: "webflow";
      workspaceId: string;
      token: string;
      site: WebflowSite;
      domains: string[];
    };

export class CmsAccessError extends HttpError {
  constructor(message: string, status = 409) {
    super(status, message);
    this.name = "CmsAccessError";
  }
}

export async function openCmsSession(
  workspaceId: string,
  provider: "wordpress" | "webflow",
  opts: { write?: boolean; seo?: WordPressSeoBackend } = {},
): Promise<CmsSession> {
  if (provider === "wordpress") {
    const { clientFor } = await import("@/server/connectors/wordpress/service.server");
    const { client, siteUrl, authType } = await clientFor(workspaceId);
    let seo = opts.seo;
    if (!seo) {
      const { wordpressNamespaces, seoBackendFor } = await import("@/server/sites/resolve.server");
      const { namespaces } = await wordpressNamespaces(workspaceId, siteUrl);
      seo = seoBackendFor(namespaces, authType);
    }
    return { provider, workspaceId, client, seo, siteUrl };
  }
  const { webflowAccess } = await import("@/server/connectors/webflow/service.server");
  const access = await webflowAccess(workspaceId, { requireWrite: opts.write });
  return {
    provider,
    workspaceId,
    token: access.token,
    site: access.site,
    domains: access.domains,
  };
}

/* ───────────────────────── keys ───────────────────────── */

/** The storage key a field is written to, per backend. Null = this backend can't hold it. */
export function wordpressKey(
  field: CmsField,
  seo: WordPressSeoBackend,
  part?: "title" | "description",
): string | null {
  const mellox: Partial<Record<CmsField, string>> = {
    seo_title: "head.title",
    meta_description: "head.description",
    canonical: "head.canonical",
    noindex: "head.noindex",
    og: part === "description" ? "head.og_description" : "head.og_title",
    jsonld_page: "head.jsonld",
    jsonld_site: "site.organization_jsonld",
    robots_txt: "site.robots_append",
    llms_txt: "site.llms_txt",
  };
  const rankmath: Partial<Record<CmsField, string>> = {
    seo_title: "rank_math_title",
    meta_description: "rank_math_description",
    canonical: "rank_math_canonical_url",
    noindex: "rank_math_robots",
    og: part === "description" ? "rank_math_facebook_description" : "rank_math_facebook_title",
  };
  const jetpack: Partial<Record<CmsField, string>> = {
    seo_title: "meta.jetpack_seo_html_title",
    meta_description: "meta.advanced_seo_description",
    noindex: "meta.jetpack_seo_noindex",
  };
  if (field === "content_html") return "content";
  if (field === "image_alt") return "alt_text";
  const table =
    seo === "mellox" ? mellox : seo === "rankmath" ? rankmath : seo === "jetpack" ? jetpack : {};
  return table[field] ?? null;
}

export function webflowKey(field: CmsField, part?: "title" | "description"): string | null {
  switch (field) {
    case "seo_title":
      return "seo.title";
    case "meta_description":
      return "seo.description";
    case "og":
      return part === "description" ? "openGraph.description" : "openGraph.title";
    case "content_html":
      return "fieldData";
    default:
      return null;
  }
}

/* ───────────────────────── WordPress ───────────────────────── */

type MelloxHead = {
  title: string;
  description: string;
  canonical: string;
  noindex: boolean;
  og_title: string;
  og_description: string;
  jsonld: unknown[];
};
type MelloxSite = {
  organization_jsonld: unknown[];
  website_jsonld: unknown[];
  robots_append: string;
  llms_txt: string;
};

async function melloxHead(client: WordPressClient, type: "post" | "page", id: number) {
  const r = await client.get<{ fields: MelloxHead }>(`mellox/v1/head?type=${type}&id=${id}`);
  return r.fields;
}

async function melloxSite(client: WordPressClient) {
  const r = await client.get<{ site: MelloxSite }>("mellox/v1/site");
  return r.site;
}

const jsonText = (v: unknown) =>
  Array.isArray(v) && v.length ? JSON.stringify(v.length === 1 ? v[0] : v, null, 2) : "";

function parseJsonLd(text: string | null | boolean): unknown[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const value = JSON.parse(text) as unknown;
  return Array.isArray(value) ? value : [value];
}

async function readWordPress(
  s: Extract<CmsSession, { provider: "wordpress" }>,
  target: CmsTarget,
  key: string,
): Promise<string | boolean | null> {
  if (target.kind === "wp_media") return (await s.client.getMedia(target.id)).alt_text ?? "";
  if (target.kind === "wp_site") {
    const site = await melloxSite(s.client);
    const k = key.replace(/^site\./, "") as keyof MelloxSite;
    const v = site[k];
    return typeof v === "string" ? v : jsonText(v);
  }
  if (target.kind !== "wp_object") throw new CmsAccessError("Wrong target for WordPress.");
  if (key === "content") return (await s.client.getObject(target.type, target.id)).content;
  if (key.startsWith("head.")) {
    const head = await melloxHead(s.client, target.type, target.id);
    const v = head[key.slice(5) as keyof MelloxHead];
    return typeof v === "string" || typeof v === "boolean" ? v : jsonText(v);
  }
  if (key.startsWith("meta.")) {
    const obj = await s.client.getObject(target.type, target.id);
    const v = obj.meta[key.slice(5)];
    return typeof v === "string" || typeof v === "boolean" ? v : v == null ? "" : String(v);
  }
  // Rank Math keeps its meta out of the REST API; the live page is the "before".
  return null;
}

async function writeWordPress(
  s: Extract<CmsSession, { provider: "wordpress" }>,
  target: CmsTarget,
  key: string,
  value: string | boolean | null,
): Promise<void> {
  if (target.kind === "wp_media") {
    await s.client.updateMediaAlt(target.id, String(value ?? "").slice(0, 250));
    return;
  }
  if (target.kind === "wp_site") {
    const k = key.replace(/^site\./, "");
    const v = k.endsWith("_jsonld") ? parseJsonLd(value) : String(value ?? "");
    await s.client.send("mellox/v1/site", { site: { [k]: v } });
    return;
  }
  if (target.kind !== "wp_object") throw new CmsAccessError("Wrong target for WordPress.");
  if (key === "content") {
    await s.client.updateObject(target.type, target.id, { content: String(value ?? "") });
    return;
  }
  if (key.startsWith("head.")) {
    const k = key.slice(5);
    const v =
      k === "jsonld" ? parseJsonLd(value) : k === "noindex" ? Boolean(value) : String(value ?? "");
    await s.client.send("mellox/v1/head", { type: target.type, id: target.id, fields: { [k]: v } });
    return;
  }
  if (key.startsWith("meta.")) {
    await s.client.updateObject(target.type, target.id, { meta: { [key.slice(5)]: value } });
    return;
  }
  // Rank Math
  const meta: Record<string, unknown> =
    key === "rank_math_robots"
      ? { rank_math_robots: value ? ["noindex"] : ["index"] }
      : { [key]: value ?? "" };
  await s.client.send("rankmath/v1/updateMeta", {
    objectType: "post",
    objectID: target.id,
    meta,
  });
}

/* ───────────────────────── Webflow ───────────────────────── */

async function webflowApi() {
  return import("@/server/connectors/webflow/api.server");
}

/** The rich-text field a CMS item's body lives in. */
export async function richTextFieldSlug(
  token: string,
  collectionId: string,
): Promise<string | null> {
  const { getCollection } = await webflowApi();
  const collection = await getCollection(token, collectionId);
  const rich = (collection.fields ?? []).filter((f) => f.type === "RichText");
  const preferred = rich.find((f) =>
    /^(post-body|body|content|post-content|article-body)$/.test(f.slug),
  );
  return (preferred ?? rich[0])?.slug ?? null;
}

async function readWebflow(
  s: Extract<CmsSession, { provider: "webflow" }>,
  target: CmsTarget,
  key: string,
): Promise<string | boolean | null> {
  const api = await webflowApi();
  if (target.kind === "webflow_page") {
    const page = await api.getPage(s.token, target.pageId);
    const [group, prop] = key.split(".") as ["seo" | "openGraph", "title" | "description"];
    const v = (page[group] as Record<string, unknown> | undefined)?.[prop];
    return typeof v === "string" ? v : "";
  }
  if (target.kind === "webflow_item") {
    const item = await api.getItem(s.token, target.collectionId, target.itemId);
    const slug = key.startsWith("fieldData.") ? key.slice(10) : null;
    const v = slug ? item.fieldData[slug] : null;
    return typeof v === "string" ? v : "";
  }
  throw new CmsAccessError("Wrong target for Webflow.");
}

async function writeWebflow(
  s: Extract<CmsSession, { provider: "webflow" }>,
  target: CmsTarget,
  key: string,
  value: string | boolean | null,
): Promise<void> {
  const api = await webflowApi();
  if (target.kind === "webflow_page") {
    const [group, prop] = key.split(".") as ["seo" | "openGraph", "title" | "description"];
    const text = String(value ?? "");
    await api.updatePageSettings(
      s.token,
      target.pageId,
      group === "seo"
        ? { seo: { [prop]: text } }
        : {
            openGraph: {
              [prop]: text,
              ...(prop === "title" ? { titleCopied: false } : { descriptionCopied: false }),
            },
          },
    );
    return;
  }
  if (target.kind === "webflow_item") {
    const slug = key.slice(10);
    await api.updateItemLive(s.token, target.collectionId, target.itemId, {
      [slug]: String(value ?? ""),
    });
    return;
  }
  throw new CmsAccessError("Wrong target for Webflow.");
}

/* ───────────────────────── public ───────────────────────── */

export function readField(s: CmsSession, change: Pick<CmsChange, "target" | "key">) {
  return s.provider === "wordpress"
    ? readWordPress(s, change.target, change.key)
    : readWebflow(s, change.target, change.key);
}

export function writeField(
  s: CmsSession,
  change: Pick<CmsChange, "target" | "key">,
  value: string | boolean | null,
) {
  return s.provider === "wordpress"
    ? writeWordPress(s, change.target, change.key, value)
    : writeWebflow(s, change.target, change.key, value);
}

/** Webflow page settings only reach the live site on a publish. */
export async function publishWebflowIfNeeded(
  s: CmsSession,
  changes: CmsChange[],
): Promise<boolean> {
  if (s.provider !== "webflow") return false;
  if (!changes.some((c) => c.target.kind === "webflow_page")) return false;
  const { publishSite } = await webflowApi();
  const customDomains = (s.site.customDomains ?? [])
    .map((d) => d.id)
    .filter((id): id is string => typeof id === "string");
  await publishSite(s.token, s.site.id, {
    ...(customDomains.length ? { customDomains } : {}),
    publishToWebflowSubdomain: true,
  });
  return true;
}

/** Values compared for drift: whitespace and JSON formatting don't count as a change. */
export function sameValue(a: string | boolean | null, b: string | boolean | null): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  const norm = (v: string | null) => {
    const t = (v ?? "").trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(t));
      } catch {
        /* not JSON */
      }
    }
    return t.replace(/\s+/g, " ");
  };
  return norm(a) === norm(b);
}
