"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { emitAppEvent } from "@/lib/app-events";
import {
  useOptionalWorkspaceId,
  useOptionalWorkspaceRole,
} from "@/components/workspace/WorkspaceProvider";
import {
  createCanvaEdit,
  getCanvaConnection,
  getCanvaEditState,
  importCanvaVersion,
  restoreCanvaOriginalAction,
  startCanvaConnect,
} from "@/lib/canva.functions";
import { onConnectResult, openConnectWindow } from "@/lib/connectors/connect-window";
import { CanvaPanel, type CanvaPanelProps } from "./CanvaPanel";

type EditState = Awaited<ReturnType<typeof getCanvaEditState>>;
type Opened = Awaited<ReturnType<typeof createCanvaEdit>>;

/**
 * One control for Canva: open the picture there as an editable design, bring
 * the edit back onto the post, or go back to the original.
 */
export function CanvaEditButton({
  assetId,
  contentId,
  variant = "button",
  onChanged,
  className,
}: {
  assetId?: string;
  contentId?: string;
  variant?: CanvaPanelProps["variant"];
  /** The post's picture changed (brought back, or the original restored). */
  onChanged?: () => void;
  className?: string;
}) {
  const workspaceId = useOptionalWorkspaceId();
  const role = useOptionalWorkspaceRole();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<CanvaPanelProps["busy"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<EditState | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId || (!assetId && !contentId)) return;
    try {
      setState(await getCanvaEditState({ data: { workspaceId, assetId, contentId } }));
    } catch {
      /* Opening in Canva still works if the state can't be read. */
    }
  }, [workspaceId, assetId, contentId]);

  useEffect(() => {
    setOpened(null);
    void refresh();
  }, [refresh]);
  // Canva was connected in its sign-in window: the button is ready to use.
  useEffect(
    () =>
      onConnectResult((result) => {
        if (result.provider !== "canva" || result.status !== "connected") return;
        toast.success("Canva connected");
        void refresh();
      }),
    [refresh],
  );
  // Coming back from the Canva tab is when the state is most likely stale.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, refresh]);

  if (!workspaceId || role === "viewer" || (!assetId && !contentId)) return null;

  const fail = (cause: unknown, fallback: string) =>
    setError(cause instanceof Error && cause.message ? cause.message : fallback);

  const openInCanva = async () => {
    // A design that already exists opens fast, so its tab is reserved inside
    // the click (browsers block a tab opened after network work). A new one
    // takes a while to make; the link appears in the panel when it is ready.
    const tab = state?.mappingId ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    setBusy("open");
    setError(null);
    try {
      const connection = await getCanvaConnection({ data: { workspaceId } });
      if (connection.status !== "active") {
        tab?.close();
        const returnPath = window.location.pathname + window.location.search;
        // Reserved before asking for the address; falls back to this tab if blocked.
        const win = openConnectWindow("canva");
        try {
          win.go((await startCanvaConnect({ data: { workspaceId, returnPath } })).url);
        } catch (cause) {
          win.close();
          throw cause;
        }
        return;
      }
      const result = await createCanvaEdit({ data: { workspaceId, assetId, contentId } });
      if (tab && !tab.closed) tab.location.replace(result.editUrl);
      setOpened(result);
      await refresh();
    } catch (cause) {
      tab?.close();
      fail(cause, "Could not open Canva.");
    } finally {
      setBusy(null);
    }
  };

  const changed = () => {
    emitAppEvent("assets:changed");
    emitAppEvent("content:changed");
    onChanged?.();
  };

  const bringBack = async () => {
    if (!state?.mappingId) return;
    setBusy("back");
    setError(null);
    try {
      const result = await importCanvaVersion({
        data: { workspaceId, mappingId: state.mappingId },
      });
      changed();
      await refresh();
      if (result.applied) {
        toast.success("Your Canva edit is on the post", {
          description: "The original is kept. You can switch back any time.",
        });
        setOpen(false);
      } else {
        toast.success("Saved to your Library", {
          description: result.locked
            ? "This post is already scheduled or published, so it wasn't changed."
            : undefined,
        });
      }
    } catch (cause) {
      fail(cause, "Could not bring back your Canva edit.");
    } finally {
      setBusy(null);
    }
  };

  const restoreOriginal = async () => {
    if (!state?.mappingId) return;
    setBusy("restore");
    setError(null);
    try {
      await restoreCanvaOriginalAction({ data: { workspaceId, mappingId: state.mappingId } });
      changed();
      await refresh();
      toast.success("Back to the original");
    } catch (cause) {
      fail(cause, "Could not switch back to the original.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <CanvaPanel
      variant={variant}
      className={className}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      mode={opened?.mode ?? state?.mode ?? null}
      slideCount={opened?.slideCount ?? state?.slideCount ?? 0}
      hasDesign={!!state?.mappingId}
      usingCanva={!!state?.usingCanva}
      opened={opened ? { editUrl: opened.editUrl, slides: opened.slideDesigns } : null}
      busy={busy}
      error={error}
      onOpen={() => void openInCanva()}
      onBringBack={() => void bringBack()}
      onUseOriginal={() => void restoreOriginal()}
    />
  );
}
