import "server-only";
// targets.server.ts — the CMS object behind a scanned page URL.
//
//   WordPress  the live page's own REST alternate link / shortlink / body class
//              (fingerprint.ts), else the slug, else the static front page
//   Webflow    the live page's data-wf-page (static page) or data-wf-collection
//              + data-wf-item-slug (CMS item), checked against the connected site
//
// Never guessed from titles: when the live page doesn't say which object it
// is, the page is "other" and per-page fixes become assisted, not applied.
import { fingerprintPage } from "@/lib/sites/fingerprint";
import type { CmsTarget } from "@/lib/geo/cms-fixes";
import { safeFetch } from "@/server/safe-fetch";
import type { CmsSession } from "./access.server";
import { CmsAccessError } from "./access.server";

export type PageKind = "wp_object" | "wp_other" | "webflow_page" | "webflow_item" | "unknown";

export type ResolvedPage = {
  pageKind: PageKind;
  /** The page's own object, when there is one. */
  target: CmsTarget | null;
  /** Site-wide settings target (robots, llms, site schema). */
  siteTarget: CmsTarget | null;
  url: string;
  html: string;
  /** WordPress object fields useful to generation (dates, author, content). */
  wordpress: { date: string | null; modified: string | null; content: string } | null;
};

async function livePage(url: string): Promise<{ html: string; finalUrl: string }> {
  const res = await safeFetch(url, {
    timeoutMs: 20_000,
    maxBytes: 3_000_000,
    headers: { "user-agent": "MelloxBot/1.0 (+https://mellox.ai)", "cache-control": "no-cache" },
  });
  if (!res.ok) throw new CmsAccessError(`The live page returned HTTP ${res.status}.`, 502);
  return { html: res.text(), finalUrl: res.url };
}

function pathSlug(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    return last && /^[a-z0-9-_%]+$/i.test(last) ? decodeURIComponent(last).toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function resolvePageTarget(s: CmsSession, pageUrl: string): Promise<ResolvedPage> {
  const { html, finalUrl } = await livePage(pageUrl);
  const f = fingerprintPage(html);

  if (s.provider === "wordpress") {
    const siteTarget: CmsTarget = { kind: "wp_site", url: s.siteUrl };
    let ref = f.wordpress?.object ?? null;
    if (!ref) {
      const isHome = new URL(finalUrl).pathname.replace(/\/+$/, "") === "";
      if (isHome) {
        const settings = await s.client.getSettings().catch(() => null);
        if (settings?.show_on_front === "page" && settings.page_on_front)
          ref = { type: "page", id: settings.page_on_front };
      } else {
        const slug = pathSlug(finalUrl);
        if (slug) {
          const post = await s.client.findBySlug("post", slug).catch(() => null);
          const page = post ? null : await s.client.findBySlug("page", slug).catch(() => null);
          const found = post ?? page;
          if (found && found.status === "publish") ref = { type: found.type, id: found.id };
        }
      }
    }
    if (!ref)
      return {
        pageKind: "wp_other",
        target: null,
        siteTarget,
        url: finalUrl,
        html,
        wordpress: null,
      };
    const obj = await s.client.getObject(ref.type, ref.id);
    if (obj.status !== "publish")
      return {
        pageKind: "wp_other",
        target: null,
        siteTarget,
        url: finalUrl,
        html,
        wordpress: null,
      };
    const raw = await s.client
      .get<{ date_gmt?: string; modified_gmt?: string }>(
        `wp/v2/${ref.type === "post" ? "posts" : "pages"}/${ref.id}?_fields=date_gmt,modified_gmt`,
      )
      .catch(() => ({}) as { date_gmt?: string; modified_gmt?: string });
    return {
      pageKind: "wp_object",
      target: { kind: "wp_object", type: ref.type, id: ref.id, url: obj.link || finalUrl },
      siteTarget,
      url: finalUrl,
      html,
      wordpress: {
        date: raw.date_gmt ? `${raw.date_gmt}Z` : null,
        modified: raw.modified_gmt ? `${raw.modified_gmt}Z` : null,
        content: obj.content,
      },
    };
  }

  // Webflow
  const wf = f.webflow;
  if (!wf?.siteId || wf.siteId !== s.site.id.toLowerCase())
    throw new CmsAccessError(
      "This page isn't served by the connected Webflow site, so Mellox won't change it.",
    );
  if (wf.collectionId && wf.itemSlug) {
    const { listItemsPage } = await import("@/server/connectors/webflow/api.server");
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = await listItemsPage(s.token, wf.collectionId, offset);
      const item = (page.items ?? []).find((i) => i.fieldData?.slug === wf.itemSlug);
      if (item)
        return {
          pageKind: "webflow_item",
          target: {
            kind: "webflow_item",
            siteId: s.site.id,
            collectionId: wf.collectionId,
            itemId: item.id,
            url: finalUrl,
          },
          siteTarget: null,
          url: finalUrl,
          html,
          wordpress: null,
        };
      if ((page.items ?? []).length < 100) break;
    }
  }
  if (wf.pageId && !wf.collectionId)
    return {
      pageKind: "webflow_page",
      target: { kind: "webflow_page", siteId: s.site.id, pageId: wf.pageId, url: finalUrl },
      siteTarget: null,
      url: finalUrl,
      html,
      wordpress: null,
    };
  return {
    pageKind: "unknown",
    target: null,
    siteTarget: null,
    url: finalUrl,
    html,
    wordpress: null,
  };
}
