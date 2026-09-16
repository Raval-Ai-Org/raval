// Canonical workspace URLs. The workspace a page acts on comes ONLY from the
// path — /w/<workspaceId>/app/... — never from localStorage or "the last
// workspace". Every link into a workspace is built here.

export const WORKSPACES_HOME = "/projects";

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
 * Re-anchor an in-app path ("/app?settings=connections", "/app/chat/x") inside
 * a workspace. Already-canonical and non-app paths are returned unchanged.
 */
export function inWorkspace(workspaceId: string, path: string): string {
  if (!path.startsWith("/app")) return path;
  const rest = path.slice("/app".length);
  if (rest && !/^[/?#]/.test(rest)) return path;
  return `/w/${workspaceId}/app${rest}`;
}

export function conversationPath(workspaceId: string, conversationId: string): string {
  return workspacePath(workspaceId, `chat/${encodeURIComponent(conversationId)}`);
}

export function onboardingPath(workspaceId: string): string {
  if (!isWorkspaceId(workspaceId)) throw new Error("onboardingPath: invalid workspace id");
  return `/w/${workspaceId}/onboarding`;
}

/** The workspace id in a canonical path, or null. */
export function workspaceIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/w\/([^/]+)(?:\/|$)/);
  return m && isWorkspaceId(m[1]) ? m[1] : null;
}

/** The conversation id in a canonical chat path, or null. */
export function conversationIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/w\/[^/]+\/app\/chat\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const LEGACY_TABS: Record<string, string> = {
  content: "content",
  social: "social",
  seo: "organic",
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
    const conversationId = decodeURIComponent(chat[1]);
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
