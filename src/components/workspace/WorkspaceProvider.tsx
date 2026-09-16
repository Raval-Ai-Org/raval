"use client";

// WorkspaceProvider — the ONE client-side source of "which workspace is this".
//
// The workspace comes from the route (/w/<workspaceId>/...) and nothing else:
// not localStorage, not "the last workspace", not the newest one. It is
// verified by the server (membership) before any workspace UI mounts, so a
// page never renders Brand A's shell while Brand B loads, and a foreign or
// deleted id lands back on /projects instead of silently opening another
// workspace.
//
// Mount it keyed by the id (`<WorkspaceProvider key={id} …>`): switching
// workspaces then unmounts every workspace-scoped component, which drops its
// state, aborts its in-flight requests and removes its cached queries.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getWorkspaceDetails } from "@/lib/workspaces.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { emitAppEvent } from "@/lib/app-events";
import { isWorkspaceId, WORKSPACES_HOME } from "@/lib/workspace/paths";
import { rememberLastWorkspace } from "@/lib/workspace/last-opened";
import { ErrorState } from "@/components/ui/empty-state";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type ActiveWorkspace = {
  id: string;
  name: string;
  websiteUrl: string | null;
  domain: string | null;
  /** What the header shows: the brand domain, else the name. */
  displayName: string;
  role: WorkspaceRole;
  isOwner: boolean;
  plan: string;
  onboarded: boolean;
  memberCount: number;
};

type Ctx = {
  workspace: ActiveWorkspace;
  /** Re-read the workspace row (after a rename or website change). */
  refresh: () => Promise<void>;
  /** Optimistically patch the loaded workspace (e.g. after a rename). */
  patch: (next: Partial<Pick<ActiveWorkspace, "name" | "websiteUrl">>) => void;
};

const WorkspaceContext = createContext<Ctx | null>(null);

type Details = Awaited<ReturnType<typeof getWorkspaceDetails>>;

export function toActiveWorkspace(d: Details): ActiveWorkspace {
  return {
    id: d.id,
    name: d.name,
    websiteUrl: d.websiteUrl ?? null,
    domain: d.domain ?? null,
    displayName: d.domain || d.name || "Workspace",
    role: d.role as WorkspaceRole,
    isOwner: d.isOwner,
    plan: d.plan,
    onboarded: d.onboarded,
    memberCount: d.memberCount,
  };
}

/** Every React Query key that belongs to this workspace (keys carry the id). */
export function queryKeyBelongsTo(key: readonly unknown[], workspaceId: string): boolean {
  return key.some((part) => part === workspaceId);
}

type State =
  | { status: "loading" }
  | { status: "ready"; workspace: ActiveWorkspace }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export function WorkspaceProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>(
    isWorkspaceId(workspaceId) ? { status: "loading" } : { status: "unavailable" },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isWorkspaceId(workspaceId)) return;
    const controller = new AbortController();
    getWorkspaceDetails({ data: { workspaceId }, signal: controller.signal })
      .then((details) => {
        if (controller.signal.aborted) return;
        const workspace = toActiveWorkspace(details);
        setState({ status: "ready", workspace });
        rememberLastWorkspace(workspace.id);
        emitAppEvent("workspace:changed", { id: workspace.id });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ServerFnError && [400, 403, 404].includes(error.status)) {
          setState({ status: "unavailable" });
          return;
        }
        if (error instanceof ServerFnError && error.status === 401) {
          const next = `${window.location.pathname}${window.location.search}`;
          router.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not open this workspace",
        });
      });
    return () => controller.abort();
  }, [workspaceId, attempt, router]);

  // Never guess another workspace: a foreign, deleted or malformed id goes home.
  useEffect(() => {
    if (state.status !== "unavailable") return;
    toast.error("That workspace isn't available", {
      description: "It may have been deleted, or you no longer have access.",
    });
    router.replace(WORKSPACES_HOME);
  }, [state.status, router]);

  // Leaving this workspace: drop its cached queries so nothing from it can be
  // shown (or refetched into) another workspace.
  useEffect(
    () => () => {
      const matches = {
        predicate: (q: { queryKey: readonly unknown[] }) =>
          queryKeyBelongsTo(q.queryKey, workspaceId),
      };
      void queryClient.cancelQueries(matches);
      queryClient.removeQueries(matches);
    },
    [queryClient, workspaceId],
  );

  const refresh = useCallback(async () => {
    try {
      const details = await getWorkspaceDetails({ data: { workspaceId } });
      setState({ status: "ready", workspace: toActiveWorkspace(details) });
    } catch {
      /* keep the loaded workspace; the next navigation re-verifies */
    }
  }, [workspaceId]);

  const patch = useCallback((next: Partial<Pick<ActiveWorkspace, "name" | "websiteUrl">>) => {
    setState((s) =>
      s.status === "ready"
        ? {
            status: "ready",
            workspace: {
              ...s.workspace,
              ...next,
              displayName: s.workspace.domain || next.name || s.workspace.name,
            },
          }
        : s,
    );
  }, []);

  const value = useMemo<Ctx | null>(
    () => (state.status === "ready" ? { workspace: state.workspace, refresh, patch } : null),
    [state, refresh, patch],
  );

  if (state.status === "error") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
        <ErrorState
          title="This workspace didn't load"
          description="Nothing from another workspace is shown while this one is unavailable."
          detail={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }

  if (!value) return <WorkspaceLoading />;

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function WorkspaceLoading() {
  return (
    <div
      className="flex h-[100dvh] w-full bg-sidebar"
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
    >
      <div className="hidden w-[48px] flex-none border-r border-border/60 sm:block" />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex h-14 items-center px-4">
          <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-end gap-4 p-6">
          <div className="w-full max-w-2xl space-y-3">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-14 w-full max-w-2xl animate-pulse rounded-2xl bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

/** The verified workspace this page acts on. Only valid under WorkspaceProvider. */
export function useWorkspace(): ActiveWorkspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx.workspace;
}

export function useWorkspaceActions(): Pick<Ctx, "refresh" | "patch"> {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceActions must be used inside WorkspaceProvider");
  return { refresh: ctx.refresh, patch: ctx.patch };
}

/** The workspace id when rendered inside a workspace, else null (shared components). */
export function useOptionalWorkspaceId(): string | null {
  return useContext(WorkspaceContext)?.workspace.id ?? null;
}
