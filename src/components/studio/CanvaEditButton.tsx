"use client";
import { useCallback, useEffect, useState } from "react";
import { Pencil } from "@/components/icons";
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
  startCanvaConnect,
  selectCanvaVersionAction,
} from "@/lib/canva.functions";

export function CanvaEditButton({
  assetId,
  contentId,
  className = "",
}: {
  assetId?: string;
  contentId?: string;
  className?: string;
}) {
  const workspaceId = useOptionalWorkspaceId();
  const role = useOptionalWorkspaceRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Awaited<ReturnType<typeof getCanvaEditState>> | null>(
    null,
  );
  const [action, setAction] = useState<"edit" | "import" | "select" | null>(null);
  const [slideLinks, setSlideLinks] = useState<Array<{ page: number; editUrl: string }>>([]);
  const refresh = useCallback(async () => {
    if (!workspaceId || (!assetId && !contentId)) return;
    try {
      setMapping(await getCanvaEditState({ data: { workspaceId, assetId, contentId } }));
    } catch {
      /* The edit action remains usable if status cannot be loaded. */
    }
  }, [workspaceId, assetId, contentId]);
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  if (!workspaceId || role === "viewer" || (!assetId && !contentId)) return null;
  const open = async () => {
    // Reserve the tab in the user gesture; browsers may block one opened after network work.
    const editor = window.open("about:blank", "_blank");
    if (!editor) {
      setError("Allow popups for Mellox and try again.");
      return;
    }
    editor.opener = null;
    setBusy(true);
    setAction("edit");
    setError(null);
    try {
      const status = await getCanvaConnection({ data: { workspaceId } });
      if (status.status !== "active") {
        editor?.close();
        const returnPath = window.location.pathname + window.location.search;
        const { url } = await startCanvaConnect({ data: { workspaceId, returnPath } });
        window.location.assign(url);
        return;
      }
      const result = await createCanvaEdit({ data: { workspaceId, assetId, contentId } });
      if (editor) editor.location.replace(result.editUrl);
      else window.open(result.editUrl, "_blank", "noopener,noreferrer");
      setSlideLinks(result.slideDesigns.slice(1));
      await refresh();
      if (result.mode === "flat_image")
        setError(
          result.slideCount > 1
            ? "Opened slide 1 in Canva. Open the other slides below; their text may not be individually editable."
            : "Opened in Canva. Original text inside the image may not be individually editable.",
        );
    } catch (e) {
      editor?.close();
      setError(e instanceof Error ? e.message : "Could not open Canva.");
    } finally {
      setBusy(false);
      setAction(null);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-label="Edit with Canva"
        disabled={busy}
        onClick={() => void open()}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-xs font-medium text-foreground hover:bg-surface-3 disabled:opacity-50 ${className}`}
      >
        <Pencil className="size-3.5" aria-hidden />
        {busy && action === "edit" ? "Preparing editable Canva design…" : "Edit with Canva"}
      </button>
      {slideLinks.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {slideLinks.map((slide) => (
            <a
              key={slide.page}
              href={slide.editUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Edit slide ${slide.page} in Canva`}
              className="rounded-full border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground"
            >
              Slide {slide.page}
            </a>
          ))}
        </span>
      )}
      {mapping?.mappingId && (
        <button
          type="button"
          aria-label="Import Canva changes"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setAction("import");
            setError(null);
            try {
              const imported = await importCanvaVersion({
                data: { workspaceId, mappingId: mapping.mappingId! },
              });
              await refresh();
              emitAppEvent("assets:changed");
              setError(`Canva version ${imported.versionNumber} imported. Original preserved.`);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not import Canva changes.");
            } finally {
              setBusy(false);
              setAction(null);
            }
          }}
          className="min-h-9 rounded-full border border-border bg-surface-2 px-3 text-xs font-medium text-foreground hover:bg-surface-3 disabled:opacity-50"
        >
          {busy && action === "import" ? "Importing Canva changes…" : "Import Canva changes"}
        </button>
      )}
      {mapping?.versionId && mapping.canSelect && (
        <button
          type="button"
          aria-label={`Use Canva version ${mapping.versionNumber}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setAction("select");
            setError(null);
            try {
              await selectCanvaVersionAction({
                data: { workspaceId, versionId: mapping.versionId! },
              });
              setError(`Canva version ${mapping.versionNumber} selected for this content.`);
              emitAppEvent("content:changed");
              emitAppEvent("assets:changed");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not select Canva version.");
            } finally {
              setBusy(false);
              setAction(null);
            }
          }}
          className="min-h-9 rounded-full border border-border bg-surface-2 px-3 text-xs font-medium text-foreground hover:bg-surface-3 disabled:opacity-50"
        >
          {busy && action === "select"
            ? "Selecting…"
            : `Use Canva version ${mapping.versionNumber}`}
        </button>
      )}
      {error && (
        <span role="status" className="max-w-64 text-xs text-muted-foreground">
          {error}
        </span>
      )}
    </span>
  );
}
