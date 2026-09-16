// Client-side isolation primitives: Studio work, React Query caches, the
// request workspace, the delete confirmation and sign-out cleanup.
import { describe, expect, it, vi } from "vitest";
import type { StudioJob } from "@/lib/studio/jobs";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const { activeSessionForWorkspace, jobsForWorkspace, sessionsForWorkspace } =
  await import("@/lib/studio/session-store");
const { queryKeyBelongsTo } = await import("@/components/workspace/WorkspaceProvider");
const { isDeleteConfirmed } = await import("@/components/workspace/DeleteWorkspaceDialog");
const { isAccountDataKey } = await import("@/lib/auth");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const session = (id: string, workspaceId: string) => ({ id, workspaceId, window: "open" }) as never;
const job = (id: string, workspace_id: string) => ({ id, workspace_id }) as unknown as StudioJob;

describe("Studio state per workspace", () => {
  const state = {
    sessions: [session("s-a", A), session("s-b", B)],
    activeId: "s-a",
    jobs: [job("j-a", A), job("j-b", B)],
  };

  it("shows each workspace only its own drafts and jobs", () => {
    expect(sessionsForWorkspace(state, B).map((s) => s.id)).toEqual(["s-b"]);
    expect(jobsForWorkspace(state, A).map((j) => j.id)).toEqual(["j-a"]);
    expect(sessionsForWorkspace(state, null)).toEqual([]);
  });

  it("never opens Brand A's composer inside Brand B", () => {
    expect(activeSessionForWorkspace(state, A)?.id).toBe("s-a");
    expect(activeSessionForWorkspace(state, B)).toBeNull();
  });
});

describe("React Query cache ownership", () => {
  it("matches keys that carry the workspace id, and nothing else", () => {
    expect(queryKeyBelongsTo(["analytics-summary", A, 30], A)).toBe(true);
    expect(queryKeyBelongsTo(["analytics-summary", B, 30], A)).toBe(false);
    expect(queryKeyBelongsTo(["account", "workspaces"], A)).toBe(false);
  });
});

describe("request workspace", () => {
  it("is read from the canonical URL when the request starts", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("window", { location: { pathname: `/w/${A}/app/chat/x` } });
    const { authedFetch, getActiveWorkspaceId } = await import("@/lib/authed-fetch");
    expect(getActiveWorkspaceId()).toBe(A);

    const pending = authedFetch("/api/x");
    // The user switches to Brand B before the request resolves.
    (window as unknown as { location: { pathname: string } }).location.pathname = `/w/${B}/app`;
    await pending;
    const headers = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Headers;
    expect(headers.get("x-workspace-id")).toBe(A);

    await authedFetch("/api/y", { workspaceId: A });
    const explicit = (fetchSpy.mock.calls[1] as unknown as [string, RequestInit])[1]
      .headers as Headers;
    expect(explicit.get("x-workspace-id")).toBe(A);

    vi.stubGlobal("window", { location: { pathname: "/projects" } });
    expect(getActiveWorkspaceId()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("destructive-action and sign-out guards", () => {
  it("delete confirmation must be exactly CONFIRM", () => {
    expect(isDeleteConfirmed("CONFIRM")).toBe(true);
    for (const text of ["", "confirm", "CONFIRM ", " CONFIRM", "Confirm", "DELETE"]) {
      expect(isDeleteConfirmed(text)).toBe(false);
    }
  });

  it("sign-out clears every account-scoped cache key", () => {
    for (const key of [
      `brand-dna:v3:${A}`,
      "studio:sessions:v2",
      `coach:briefing:v1:${A}`,
      `content-calendar:${A}`,
      `chat:prefill:${A}`,
    ]) {
      expect(isAccountDataKey(key)).toBe(true);
    }
    expect(isAccountDataKey("theme")).toBe(false);
  });
});
