// The last workspace a user opened — a CONVENIENCE for highlighting it in
// lists and switchers. It never decides which workspace a page acts on, and
// sign-in never auto-opens it (sign-in lands on /projects).

const KEY = "workspace:last-opened";
// Pre-/w/ builds stored the "active" workspace under these keys.
const LEGACY_KEYS = ["workspace:selected", "workspace:name", "workspace:website"];

export function rememberLastWorkspace(workspaceId: string): void {
  try {
    localStorage.setItem(KEY, workspaceId);
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetLastWorkspace(workspaceId?: string): void {
  try {
    if (!workspaceId || localStorage.getItem(KEY) === workspaceId) localStorage.removeItem(KEY);
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

/** Every browser-cached key that holds data for one workspace. */
export function isWorkspaceScopedStorageKey(key: string, workspaceId: string): boolean {
  return key.includes(workspaceId);
}

/** Remove every locally cached entry for a workspace (after it is deleted). */
export function clearWorkspaceLocalData(workspaceId: string): void {
  forgetLastWorkspace(workspaceId);
  for (const store of [safeStorage("local"), safeStorage("session")]) {
    if (!store) continue;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && isWorkspaceScopedStorageKey(k, workspaceId)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  }
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}
