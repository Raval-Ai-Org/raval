// Canonical workspace URLs. The workspace a page acts on comes ONLY from the
// path — /w/<workspaceId>/app/... — never from localStorage or "the last
// workspace". Every link into a workspace is built here.

export const WORKSPACES_HOME = "/projects";

/** The workspace list itself, shown even when there is only one workspace. */
export const ALL_WORKSPACES = `${WORKSPACES_HOME}?all=1`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * `/w/<id>/app` plus an optional sub-path and search.
 *   workspacePath(id)                         → /w/<id>/app
 *   workspacePath(id, "chat/abc")             → /w/<id>/app/chat/abc
 *   workspacePath(id, "", { tab: "social" })  → /w/<id>/app?tab=social
 */
export function workspacePath(
  workspaceId: string,
  sub = "",
  search?: Record<string, string | number | boolean | null | undefined> | string,
): string {
  if (!isWorkspaceId(workspaceId)) throw new Error("workspacePath: invalid workspace id");
  const clean = sub.replace(/^\/+|\/+$/g, "");
  let qs = "";
  if (typeof search === "string") {
    qs = search && !search.startsWith("?") ? `?${search}` : search;
  } else if (search) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(search)) {
      if (v === undefined || v === null || v === "" || v === false) continue;
      params.set(k, String(v));
    }
    const s = params.toString();
    qs = s ? `?${s}` : "";
  }
  return `/w/${workspaceId}/app${clean ? `/${clean}` : ""}${qs}`;
}

/**
 * Brain (ADR-0032): the four brains and the strategy.
 *   brainPath(id)                      → /w/<id>/app/brain
 *   brainPath(id, "brand", "look")     → /w/<id>/app/brain?s=brand&t=look
 */
export function brainPath(
  workspaceId: string,
  section?: string | null,
  tab?: string | null,
): string {
  return workspacePath(workspaceId, "brain", {
    s: section && section !== "home" ? section : undefined,
    t: tab,
  });
}

/**
 * Inspo (ADR-0037): how the brand's posts look and sound, and its own media.
 *   inspoPath(id)          → /w/<id>/app/inspo
 *   inspoPath(id, "voice") → /w/<id>/app/inspo?s=voice
 */
export function inspoPath(workspaceId: string, section?: string | null): string {
  return workspacePath(workspaceId, "inspo", {
    s: section && section !== "board" ? section : undefined,
  });
}

/**
 * Campaigns (ADR-0039): planned runs of posts and Stories.
 *   campaignsPath(id)                       → /w/<id>/app/campaigns
 *   campaignsPath(id, { c: "<campaign>" })  → one campaign
 *   campaignsPath(id, { v: "new", type })   → the designer, on a kind
 */
export function campaignsPath(
  workspaceId: string,
  opts: { c?: string | null; v?: "new" | null; type?: string | null; tab?: string | null } = {},
): string {
  return workspacePath(workspaceId, "campaigns", {
    c: opts.c,
    v: opts.v,
    type: opts.type,
    tab: opts.tab && opts.tab !== "overview" ? opts.tab : undefined,
  });
}

/**
 * Channels: every social account and app the brand connects, in one place.
 *   channelsPath(id)         → /w/<id>/app/channels
 *   channelsPath(id, "apps") → /w/<id>/app/channels?s=apps
 */
export function channelsPath(workspaceId: string, section?: string | null): string {
  return workspacePath(workspaceId, "channels", {
    s: section && section !== "social" ? section : undefined,
  });
}

/**
 * Communities: the threads where people ask about what the brand does
 * (Reddit, Quora, Hacker News, Stack Exchange).
 *   communitiesPath(id) → /w/<id>/app/communities
 */
export function communitiesPath(workspaceId: string): string {
  return workspacePath(workspaceId, "communities");
}

/**
 * Re-anchor an in-app path ("/app?settings=connections", "/app/chat/x") inside
 * a workspace. Already-canonical and non-app paths are returned unchanged.
 */
export function inWorkspace(workspaceId: string, path: string): string {
  if (!path.startsWith("/app")) return path;
  const rest = path.slice("/app".length);
  if (rest && !/^[/?#]/.test(rest)) return path;
  return `/w/${workspaceId}/app${rest}`;
}

/**
 * Chat with no conversation open (Mellox 2.0): Home is the bento, this is the
 * empty thread with the conversations list beside it.
 *   chatPath(id) → /w/<id>/app?view=chat
 */
export function chatPath(workspaceId: string): string {
  return `${workspacePath(workspaceId)}?view=chat`;
}

export function conversationPath(workspaceId: string, conversationId: string): string {
  return workspacePath(workspaceId, `chat/${encodeURIComponent(conversationId)}`);
}

/**
 * `start: "manual"` opens onboarding on the brand kit (no website, no scan),
 * for a brand created from "No website?" on the projects page.
 */
export function onboardingPath(workspaceId: string, opts?: { start?: "manual" }): string {
  if (!isWorkspaceId(workspaceId)) throw new Error("onboardingPath: invalid workspace id");
  return `/w/${workspaceId}/onboarding${opts?.start === "manual" ? "?start=manual" : ""}`;
}

/** The workspace id in a canonical path, or null. */
export function workspaceIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/w\/([^/]+)(?:\/|$)/);
  return m && isWorkspaceId(m[1]) ? m[1] : null;
}

/** The conversation id in a canonical chat path, or null. */
export function conversationIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/w\/[^/]+\/app\/chat\/([^/?#]+)/);
  return m ? decodeConversationId(m[1]) : null;
}

function decodeConversationId(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const LEGACY_TABS: Record<string, string> = {
  content: "content",
  social: "content",
  seo: "search",
  analytics: "overview",
};

export type LegacyTarget =
  | { kind: "workspace"; href: string }
  /** A legacy chat link: the conversation's own workspace must be looked up. */
  | { kind: "conversation"; conversationId: string; search: string }
  | { kind: "home"; href: string };

/**
 * Resolve a pre-/w/ link (`/app`, `/workspace`, `/app/content`, `/app/chat/x`)
 * without guessing a workspace: an explicit `?workspace=<id>` is honoured, a
 * chat link resolves via its conversation, anything else goes to /projects.
 */
export function resolveLegacyAppLink(pathname: string, search: string): LegacyTarget {
  const params = new URLSearchParams(search);
  const explicit = params.get("workspace");
  params.delete("workspace");

  const chat = pathname.match(/^\/app\/chat\/([^/?#]+)/);
  if (chat) {
    const conversationId = decodeConversationId(chat[1]);
    if (conversationId === null) return { kind: "home", href: WORKSPACES_HOME };
    if (isWorkspaceId(explicit)) {
      const qs = params.toString();
      return {
        kind: "workspace",
        href: `${conversationPath(explicit, conversationId)}${qs ? `?${qs}` : ""}`,
      };
    }
    const qs = params.toString();
    return { kind: "conversation", conversationId, search: qs ? `?${qs}` : "" };
  }

  if (!isWorkspaceId(explicit)) return { kind: "home", href: WORKSPACES_HOME };

  const section = pathname.match(/^\/app\/([a-z]+)/)?.[1];
  if (section === "library") params.set("library", "1");
  else if (section && LEGACY_TABS[section] && !params.get("tab")) {
    params.set("tab", LEGACY_TABS[section]);
  }
  return { kind: "workspace", href: workspacePath(explicit, "", params.toString()) };
}

/**
 * Where landing on Mellox goes (sign-in, the site root, a bare /projects):
 * the person's only workspace, straight in (or its setup), so one brand never
 * sees the list. Two or more, none, or an explicit list request (?all, ?add)
 * stay on the list. This is not a "last workspace" fallback: with one
 * workspace there is nothing to choose.
 */
export function soleWorkspaceLanding(
  workspaces: readonly { id: string; onboarded: boolean }[],
  search: string,
): string | null {
  const params = new URLSearchParams(search);
  if (params.has("all") || params.has("add")) return null;
  if (workspaces.length !== 1) return null;
  const only = workspaces[0];
  if (!isWorkspaceId(only.id)) return null;
  return only.onboarded ? workspacePath(only.id) : onboardingPath(only.id);
}
