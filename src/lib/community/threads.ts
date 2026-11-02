// threads.ts — turning search results and API answers into threads. Pure.
//
// A thread is shown only with the real link a search or API returned. Links
// that are not a discussion (a profile, a subreddit's front page, a Quora
// topic) are dropped, and the identity of a thread is its own id on the
// network, so the same discussion found by two queries is one row.
import type { CommunitySource, MatchKind } from "./contracts";
import type { CommunityQuery } from "./queries";

export type RawThread = {
  url: string;
  source: CommunitySource;
  community: string;
  title: string;
  snippet: string;
  postedAt: string | null;
  matchedOn: MatchKind;
  matchedTerm: string;
  competitorName: string | null;
  fingerprint: string;
};

const MAX_TITLE = 240;
const MAX_SNIPPET = 600;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");
}

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

function hostIs(u: URL, base: string): boolean {
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  return h === base || h.endsWith(`.${base}`);
}

/** Where a link lives, and its identity there. Null when it is not a discussion. */
export function threadIdentity(
  url: string,
): { source: CommunitySource; community: string; fingerprint: string; url: string } | null {
  const u = parse(url);
  if (!u) return null;
  if (hostIs(u, "reddit.com") || hostIs(u, "redd.it")) {
    const m = u.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{3,12})(?:\/|$)/i);
    if (!m) return null;
    return {
      source: "reddit",
      community: `r/${m[1]}`,
      fingerprint: `reddit:${m[2].toLowerCase()}`,
      url: `https://www.reddit.com/r/${m[1]}/comments/${m[2]}/`,
    };
  }
  if (hostIs(u, "quora.com")) {
    const path = u.pathname.replace(/\/+$/, "");
    // Questions are one path segment ("/How-do-I-…"); answers sit under it.
    const m = path.match(/^\/([A-Za-z0-9][A-Za-z0-9-]{8,200})(?:\/answers?\/[^/]+)?$/);
    if (!m || /^(profile|topic|spaces?|search|about|q)$/i.test(m[1])) return null;
    if (!m[1].includes("-")) return null;
    return {
      source: "quora",
      community: "Quora",
      fingerprint: `quora:${m[1].toLowerCase()}`,
      url: `https://www.quora.com/${m[1]}`,
    };
  }
  if (u.hostname === "news.ycombinator.com") {
    const id = u.pathname === "/item" ? u.searchParams.get("id") : null;
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    return {
      source: "hackernews",
      community: "Hacker News",
      fingerprint: `hn:${id}`,
      url: `https://news.ycombinator.com/item?id=${id}`,
    };
  }
  const se = stackSiteFromHost(u.hostname.toLowerCase());
  if (se) {
    const m = u.pathname.match(/^\/(?:questions|q)\/(\d{1,12})(?:\/|$)/);
    if (!m) return null;
    return {
      source: "stackexchange",
      community: se,
      fingerprint: `se:${se}:${m[1]}`,
      url: `${u.protocol}//${u.hostname}/questions/${m[1]}`,
    };
  }
  return null;
}

function stackSiteFromHost(host: string): string | null {
  const h = host.replace(/^www\./, "");
  if (["stackoverflow.com", "superuser.com", "serverfault.com", "askubuntu.com"].includes(h)) {
    return h.replace(/\.com$/, "");
  }
  const m = h.match(/^([a-z0-9-]+)\.stackexchange\.com$/);
  return m && m[1] !== "api" && m[1] !== "meta" ? m[1] : null;
}

/** The query fields a result inherits. */
type Origin = Pick<CommunityQuery, "matchedOn" | "term" | "competitorName">;

function fromOrigin(origin: Origin) {
  return {
    matchedOn: origin.matchedOn,
    matchedTerm: origin.term,
    competitorName: origin.competitorName,
  };
}

/** A web search result, if it really is a Reddit or Quora discussion. */
export function threadFromWebResult(
  result: { url: string; title: string; snippet: string; publishedDate?: string | null },
  origin: Origin & { source: CommunitySource },
): RawThread | null {
  const id = threadIdentity(result.url);
  if (!id || id.source !== origin.source) return null;
  const title = clip(
    stripTags(result.title)
      .replace(/\s*[-|:]\s*(reddit|quora)\s*$/i, "")
      .replace(/^r\/\w+\s*[-|:]\s*/i, ""),
    MAX_TITLE,
  );
  if (title.length < 6) return null;
  return {
    ...id,
    title,
    snippet: clip(stripTags(result.snippet ?? ""), MAX_SNIPPET),
    postedAt: isoOrNull(result.publishedDate),
    ...fromOrigin(origin),
  };
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const t = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

/** Hits from the Algolia Hacker News search API (`/api/v1/search_by_date`). */
export function threadsFromHn(json: unknown, origin: Origin): RawThread[] {
  const hits = (json as { hits?: unknown[] } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  const out: RawThread[] = [];
  for (const raw of hits) {
    const hit = raw as Record<string, unknown>;
    const id = String(hit.objectID ?? hit.story_id ?? "");
    const title = typeof hit.title === "string" ? hit.title : "";
    if (!/^\d{1,12}$/.test(id) || title.trim().length < 6) continue;
    const identity = threadIdentity(`https://news.ycombinator.com/item?id=${id}`);
    if (!identity) continue;
    out.push({
      ...identity,
      title: clip(stripTags(title), MAX_TITLE),
      snippet: clip(
        stripTags(typeof hit.story_text === "string" ? hit.story_text : ""),
        MAX_SNIPPET,
      ),
      postedAt: isoOrNull(hit.created_at_i ?? hit.created_at),
      ...fromOrigin(origin),
    });
  }
  return out;
}

/** Items from the Stack Exchange API (`/2.3/search/advanced`). */
export function threadsFromStackExchange(json: unknown, origin: Origin): RawThread[] {
  const items = (json as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: RawThread[] = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const link = typeof item.link === "string" ? item.link : "";
    const identity = threadIdentity(link);
    const title = typeof item.title === "string" ? stripTags(item.title) : "";
    if (!identity || title.trim().length < 6) continue;
    const tags = Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [];
    out.push({
      ...identity,
      title: clip(title, MAX_TITLE),
      snippet: clip(
        stripTags(
          typeof item.body_markdown === "string"
            ? item.body_markdown
            : typeof item.body === "string"
              ? item.body
              : "",
        ) || (tags.length ? `Tagged ${tags.slice(0, 5).join(", ")}` : ""),
        MAX_SNIPPET,
      ),
      postedAt: isoOrNull(item.creation_date),
      ...fromOrigin(origin),
    });
  }
  return out;
}

const KIND_RANK: Record<MatchKind, number> = {
  alternative: 0,
  problem: 1,
  competitor: 2,
  category: 3,
};

/**
 * One row per discussion. When two queries found the same thread, the more
 * specific reason wins (an "alternative to X" beats "about your field").
 * Threads already stored (`known`) are left out.
 */
export function mergeThreads(
  raw: RawThread[],
  known: ReadonlySet<string> = new Set(),
): RawThread[] {
  const byFp = new Map<string, RawThread>();
  for (const t of raw) {
    if (known.has(t.fingerprint)) continue;
    const prev = byFp.get(t.fingerprint);
    if (!prev || KIND_RANK[t.matchedOn] < KIND_RANK[prev.matchedOn]) {
      byFp.set(t.fingerprint, prev ? { ...t, snippet: t.snippet || prev.snippet } : t);
    }
  }
  return [...byFp.values()];
}
