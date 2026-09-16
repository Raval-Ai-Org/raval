"use client";

// Permanently delete ONE workspace. The owner types CONFIRM exactly; the
// button stays disabled until they do, and the server checks it again. Only
// this workspace's data goes — never the account or any other workspace.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Trash2 } from "@/components/icons";
import { deleteWorkspace } from "@/lib/workspaces.functions";
import { clearWorkspaceLocalData } from "@/lib/workspace/last-opened";
import { WORKSPACES_HOME } from "@/lib/workspace/paths";
import { queryKeyBelongsTo } from "@/components/workspace/WorkspaceProvider";
import { WORKSPACES_QUERY_KEY } from "@/hooks/use-workspaces";
import { emitAppEvent } from "@/lib/app-events";

export const DELETE_CONFIRMATION = "CONFIRM";

export const DELETED_DATA = [
  "Brand DNA, logo, colors, voice, audience and goals",
  "Chats, memories and notes",
  "Studio drafts, generated images and videos, and uploaded assets",
  "Content calendar, approvals, scheduled and published post records",
  "Social account and GitHub connections for this workspace",
  "Analytics, SEO / GEO scans and fixes, competitor tracking",
  "Agent tasks, automations and workspace settings",
];

/** The typed confirmation must match exactly — case and whitespace included. */
export function isDeleteConfirmed(text: string): boolean {
  return text === DELETE_CONFIRMATION;
}

export type DeletableWorkspace = {
  id: string;
  name: string;
  domain: string | null;
  websiteUrl?: string | null;
};

export function DeleteWorkspaceDialog({
  workspace,
  onOpenChange,
  onDeleted,
}: {
  workspace: DeletableWorkspace | null;
  onOpenChange: (open: boolean) => void;
  /** Runs after caches are cleared; the dialog then routes to /projects unless told otherwise. */
  onDeleted?: (id: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTyped("");
    setDeleting(false);
  }, [workspace?.id]);

  const confirmed = isDeleteConfirmed(typed);

  const run = async () => {
    if (!workspace || !confirmed || deleting) return;
    const target = workspace;
    setDeleting(true);
    try {
      await deleteWorkspace({ data: { workspaceId: target.id, confirmation: typed } });
    } catch (e) {
      setDeleting(false);
      toast.error("Couldn't delete this workspace", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
      return;
    }

    const matches = {
      predicate: (q: { queryKey: readonly unknown[] }) => queryKeyBelongsTo(q.queryKey, target.id),
    };
    await queryClient.cancelQueries(matches);
    queryClient.removeQueries(matches);
    clearWorkspaceLocalData(target.id);
    await queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
    emitAppEvent("workspace:changed", { id: null });

    toast.success(`Deleted ${target.domain || target.name}`, {
      description: "The workspace and its data were permanently removed.",
    });
    onOpenChange(false);
    onDeleted?.(target.id);
    // Never leave the user on a route for a workspace that no longer exists.
    if (window.location.pathname.startsWith(`/w/${target.id}`)) router.replace(WORKSPACES_HOME);
  };

  return (
    <AppModalShell
      open={!!workspace}
      onOpenChange={(v) => {
        if (!deleting) onOpenChange(v);
      }}
      size="sm"
      Icon={Trash2}
      eyebrow="Danger zone"
      title="Delete workspace"
      description="This permanently deletes the workspace and everything in it."
      disableClose={deleting}
    >
      {workspace && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="rounded-xl border border-border/70 bg-secondary/40 px-3.5 py-3">
            <div className="text-[14px] font-semibold text-foreground">{workspace.name}</div>
            <div className="text-[12.5px] text-muted-foreground">
              {workspace.domain || workspace.websiteUrl || "No website"}
            </div>
          </div>

          <div
            role="alert"
            className="flex gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-[13px] text-foreground"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium">This can't be undone.</p>
              <p className="mt-0.5 text-muted-foreground">
                Your account and your other workspaces are not affected.
              </p>
            </div>
          </div>

          <div>
            <p className="text-[12.5px] font-medium text-foreground">What will be deleted</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-muted-foreground">
              {DELETED_DATA.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="delete-workspace-confirm" className="text-[12.5px] text-foreground">
              Type <span className="font-mono font-semibold">{DELETE_CONFIRMATION}</span> to confirm
            </label>
            <input
              id="delete-workspace-confirm"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={deleting}
              aria-invalid={typed.length > 0 && !confirmed}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!confirmed || deleting}
              className="gap-1.5"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              )}
              Delete workspace
            </Button>
          </div>
        </form>
      )}
    </AppModalShell>
  );
}
