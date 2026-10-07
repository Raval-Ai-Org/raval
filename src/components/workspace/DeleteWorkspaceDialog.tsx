"use client";

// Permanently delete ONE workspace. The owner types CONFIRM exactly; the
// button stays disabled until they do, and the server checks it again. Only
// this workspace's data goes — never the account or any other workspace.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "@/components/icons";
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
    <DialogPrimitive.Root
      open={!!workspace}
      onOpenChange={(v) => {
        if (!deleting) onOpenChange(v);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-mellox-app
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border/70 bg-background p-6 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 sm:p-7"
        >
          <DialogPrimitive.Description className="sr-only">
            This permanently deletes the workspace and everything in it.
          </DialogPrimitive.Description>
          {workspace && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" aria-hidden />
              </div>

              <DialogPrimitive.Title className="mt-4 text-[19px] font-semibold tracking-tight text-foreground">
                Delete {workspace.name || workspace.domain || "this workspace"}?
              </DialogPrimitive.Title>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                This permanently removes the workspace and everything in it. It can't be undone.
                Your account and other workspaces stay as they are.
              </p>

              <details className="group mt-4 rounded-2xl bg-secondary/50 px-4 py-3 text-[13px]">
                <summary className="cursor-pointer list-none font-medium text-foreground marker:hidden">
                  What gets deleted
                  <span className="ml-1 text-muted-foreground group-open:hidden">· show</span>
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {DELETED_DATA.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>

              <div className="mt-5 space-y-1.5">
                <label htmlFor="delete-workspace-confirm" className="text-[13px] text-foreground">
                  Type <span className="font-mono font-semibold">{DELETE_CONFIRMATION}</span> to
                  confirm
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
                  className="h-11 w-full rounded-xl border border-input bg-background px-3.5 font-mono text-[14px] outline-none transition focus-visible:border-destructive/60 focus-visible:ring-2 focus-visible:ring-destructive/25"
                />
              </div>

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={deleting}
                  className="h-11 rounded-full px-5"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={!confirmed || deleting}
                  className="h-11 gap-1.5 rounded-full px-5"
                >
                  {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Delete workspace
                </Button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
