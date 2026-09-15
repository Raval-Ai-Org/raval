// github-return.ts — hands the result of a finished GitHub connection from the
// callback page to the Mellox page it returns to (same origin, same tab), so
// that page can confirm it and go straight to choosing a repository. The
// connection itself is always re-read from the server; this only drives the
// confirmation banner.

const KEY = "mellox:github-connected";
const MAX_AGE_MS = 5 * 60_000;

export type GithubConnectedNotice = { workspaceId: string; accounts: string[] };

export function rememberGithubConnected(notice: GithubConnectedNotice): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...notice, at: Date.now() }));
  } catch {
    /* storage unavailable — the page still shows the reloaded connection */
  }
}

/** Read and clear the notice for this workspace, if a connection just finished. */
export function takeGithubConnected(workspaceId: string): GithubConnectedNotice | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GithubConnectedNotice> & { at?: number };
    if (parsed.workspaceId !== workspaceId) return null;
    sessionStorage.removeItem(KEY);
    if (!parsed.at || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return {
      workspaceId,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts.map(String).slice(0, 10) : [],
    };
  } catch {
    return null;
  }
}
