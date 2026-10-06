"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { emitAppEvent } from "@/lib/app-events";
import { ServerFnError } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { Settings2 } from "@/components/ui/gemini-icons";
import {
  getNotionConnection,
  startNotionConnect,
  disconnectNotion,
  listNotionDestinations,
  selectNotionDestination,
  createNotionDestination,
  exportToNotion,
  previewNotionImport,
  importFromNotion,
  syncNotionNow,
  listNotionConflicts,
  resolveNotionConflict,
} from "@/lib/notion.functions";

type Status = Awaited<ReturnType<typeof getNotionConnection>>;
type Destination = Awaited<ReturnType<typeof listNotionDestinations>>[number];
type Preview = Awaited<ReturnType<typeof previewNotionImport>>;
type Conflict = Awaited<ReturnType<typeof listNotionConflicts>>[number];
function NotionMark({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("shrink-0 fill-current", compact ? "size-4" : "size-9")}
    >
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
    </svg>
  );
}
function countText(result: Record<string, number>) {
  return (
    Object.entries(result)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${count} ${label}`)
      .join(" · ") || "No changes"
  );
}
function relativeSyncTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (!Number.isFinite(minutes)) return "Last sync unavailable";
  if (minutes < 1) return "Last synced just now";
  if (minutes < 60) return `Last synced ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last synced ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Last synced ${new Date(value).toLocaleDateString()}`;
}
export function NotionConnection({
  workspaceId,
  compact = false,
  contentIds,
}: {
  workspaceId: string;
  compact?: boolean;
  contentIds?: string[];
}) {
  const role = useOptionalWorkspaceRole();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [parentId, setParentId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setStatus(await getNotionConnection({ data: { workspaceId } }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Notion connection.");
    }
  }, [workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (compact) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("notion") === "connected") {
      toast.success("Notion connected");
      setSetup(true);
      url.searchParams.delete("notion");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [compact]);
  useEffect(() => {
    if (!setup) return;
    void listNotionDestinations({ data: { workspaceId } })
      .then(setDestinations)
      .catch((cause) => {
        if (
          cause instanceof ServerFnError &&
          cause.status === 409 &&
          /reconnect/i.test(cause.message)
        )
          setStatus((current) => (current ? { ...current, status: "error" } : current));
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load shared Notion pages and data sources.",
        );
      });
  }, [setup, workspaceId]);
  const run = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError(null);
    try {
      const value = await operation();
      if (success) toast.success(success);
      await refresh();
      emitAppEvent("connections:changed");
      return value;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Notion could not complete this action.";
      if (e instanceof ServerFnError && e.status === 409 && /reconnect/i.test(message))
        setStatus((current) => (current ? { ...current, status: "error" } : current));
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const connect = () =>
    void run(async () => {
      const { url } = await startNotionConnect({
        data: { workspaceId, returnPath: `${window.location.pathname}?settings=accounts` },
      });
      window.location.assign(url);
    });
  const exportItems = () =>
    void run(async () => {
      const value = await exportToNotion({ data: { workspaceId, contentIds } });
      setResult(value);
      return value;
    }, "Notion export complete");
  const sync = () =>
    void run(async () => {
      const value = await syncNotionNow({ data: { workspaceId } });
      setResult(value);
      if (value.conflicts) setConflicts(await listNotionConflicts({ data: { workspaceId } }));
      emitAppEvent("content:changed");
      return value;
    }, "Notion sync complete");
  const openPreview = () =>
    void run(async () => setPreview(await previewNotionImport({ data: { workspaceId } })));
  const connected = status?.status === "active";
  const needsAttention = status?.status === "error";
  const actions = (
    <>
      {!connected ? (
        <>
          <Button size="sm" disabled={busy || !canEdit || !status?.configured} onClick={connect}>
            {needsAttention ? "Reconnect Notion" : "Connect Notion"}
          </Button>
          {needsAttention && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !canEdit}
              onClick={() => setDisconnectOpen(true)}
            >
              Disconnect
            </Button>
          )}
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canEdit}
            onClick={() => setSetup(true)}
          >
            {status.dataSourceId ? "Change database" : "Choose database"}
          </Button>
          {status.dataSourceId && canEdit && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={sync}>
                Sync now
              </Button>
              {!compact && (
                <Button size="sm" variant="outline" disabled={busy} onClick={exportItems}>
                  Export to Notion
                </Button>
              )}
              {!compact && (
                <Button size="sm" variant="outline" disabled={busy} onClick={openPreview}>
                  Import from Notion
                </Button>
              )}
            </>
          )}
          {!compact && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !canEdit}
              onClick={() => setDisconnectOpen(true)}
            >
              Disconnect
            </Button>
          )}
        </>
      )}
    </>
  );
  return (
    <>
      {compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(dsGhostBtn, "h-8 gap-1.5 px-3 text-[12px]")}
              aria-label="Notion calendar actions"
            >
              <NotionMark compact /> Notion{connected ? " ✓" : ""}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!connected ? (
              <>
                <DropdownMenuItem
                  disabled={!canEdit || busy || !status?.configured}
                  onSelect={connect}
                >
                  {needsAttention ? "Reconnect Notion" : "Connect Notion"}
                </DropdownMenuItem>
                {status && !status.configured && (
                  <DropdownMenuItem disabled>
                    {status.configurationMessage ?? "Notion needs server configuration."}
                  </DropdownMenuItem>
                )}
                {needsAttention && (
                  <DropdownMenuItem onSelect={() => setDisconnectOpen(true)}>
                    Disconnect
                  </DropdownMenuItem>
                )}
              </>
            ) : (
              <>
                <DropdownMenuItem
                  disabled={!canEdit || busy || !status.dataSourceId}
                  onSelect={exportItems}
                >
                  Export {contentIds ? "current view" : "all"} to Notion
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canEdit || busy || !status.dataSourceId}
                  onSelect={openPreview}
                >
                  Import from Notion
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canEdit || busy || !status.dataSourceId}
                  onSelect={sync}
                >
                  Sync now
                </DropdownMenuItem>
                {status.destinationUrl && (
                  <DropdownMenuItem asChild>
                    <a href={status.destinationUrl} target="_blank" rel="noopener noreferrer">
                      Open in Notion
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setSetup(true)}>Change database</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => emitAppEvent("open:settings", { section: "accounts" })}
                >
                  <Settings2 className="mr-2 size-4" />
                  Settings
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <section className="ds-tile p-4" aria-label="Notion connection">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <NotionMark />
              <div>
                <h3 className="font-semibold">Notion</h3>
                <p className="text-xs text-muted-foreground">
                  Sync your Mellox content calendar with Notion.
                </p>
              </div>
            </div>
            {!status ? (
              <Skeleton className="h-8 w-28 rounded-full" />
            ) : (
              <span className="rounded-full bg-[var(--ds-well-bg)] px-3 py-1 text-xs">
                {connected
                  ? busy
                    ? "Syncing"
                    : result?.conflicts
                      ? "Conflict"
                      : result
                        ? "Synced"
                        : "Connected"
                  : status.status === "error"
                    ? "Needs attention"
                    : "Disconnected"}
              </span>
            )}
          </div>
          {connected && (
            <div className="mt-3 text-xs text-muted-foreground">
              <p>{status.workspaceName}</p>
              <p>{status.destinationName ?? "Choose a content calendar"}</p>
              <p>{status.lastSyncAt ? relativeSyncTime(status.lastSyncAt) : "Never synced"}</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {actions}
            {connected && status.destinationUrl && (
              <a
                className={cn(dsGhostBtn, "px-3 text-xs")}
                href={status.destinationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Notion
              </a>
            )}
          </div>
          {!status?.configured && status && (
            <p className="mt-2 text-xs text-muted-foreground">
              {status.configurationMessage ?? "Notion needs server configuration."}
            </p>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog open={setup} onOpenChange={setSetup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a Notion calendar</DialogTitle>
            <DialogDescription>
              Select a shared data source, or create a new calendar inside a shared page.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {destinations
              .filter((d) => d.kind === "data_source")
              .map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={busy}
                  className="ds-tile ds-tile-hover w-full p-3 text-left text-sm"
                  onClick={() =>
                    void run(async () => {
                      await selectNotionDestination({ data: { workspaceId, dataSourceId: d.id } });
                      setSetup(false);
                    }, "Notion calendar selected")
                  }
                >
                  {d.name}
                </button>
              ))}
            {!destinations.some((d) => d.kind === "data_source") && (
              <p className="text-sm text-muted-foreground">
                No shared data sources found. Share a Notion database with Mellox first.
              </p>
            )}
          </div>
          <label className="text-xs text-muted-foreground" htmlFor="notion-parent">
            Create in a shared page
          </label>
          <select
            id="notion-parent"
            className="ds-well w-full rounded-xl p-2 text-sm"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">Choose a page</option>
            {destinations
              .filter((d) => d.kind === "page")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
          <DialogFooter>
            <Button
              disabled={busy || !parentId}
              onClick={() =>
                void run(async () => {
                  await createNotionDestination({ data: { workspaceId, parentPageId: parentId } });
                  setSetup(false);
                }, "Notion calendar created")
              }
            >
              Create calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from Notion</DialogTitle>
            <DialogDescription>
              Review the rows before adding or updating Mellox drafts. Nothing will publish
              automatically.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <p className="text-sm">
                {preview.total} rows · {preview.valid} valid · {preview.invalid} invalid ·{" "}
                {preview.duplicates} already linked
              </p>
              <div className="max-h-60 overflow-y-auto text-sm">
                {preview.rows.map((r) => (
                  <div key={r.pageId} className="border-b border-border py-2">
                    {r.title}{" "}
                    <span className="text-muted-foreground">
                      {r.error ?? (r.duplicate ? "Linked" : "New")}
                    </span>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={busy || !preview.valid}
                  onClick={() =>
                    void run(async () => {
                      const value = await importFromNotion({
                        data: { workspaceId, pageIds: preview.rows.map((row) => row.pageId) },
                      });
                      setPreview(null);
                      setResult(value);
                      emitAppEvent("content:changed");
                    }, "Notion import complete")
                  }
                >
                  Confirm import
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!result}
        onOpenChange={(open) => {
          if (!open) setResult(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notion sync result</DialogTitle>
            <DialogDescription>{result ? countText(result) : ""}</DialogDescription>
          </DialogHeader>
          {result && result.conflicts > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                void run(async () =>
                  setConflicts(await listNotionConflicts({ data: { workspaceId } })),
                )
              }
            >
              View conflicts
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!conflicts}
        onOpenChange={(open) => {
          if (!open) setConflicts(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Notion conflicts</DialogTitle>
            <DialogDescription>
              Both versions changed since the last sync. Choose which one to keep.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-4 overflow-y-auto">
            {conflicts?.map((c) => (
              <div className="ds-tile p-3" key={c.mappingId}>
                <p className="text-sm font-semibold">{c.mellox.title || c.notion.title}</p>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <strong>Mellox</strong>
                    <p className="whitespace-pre-wrap">{c.mellox.body.slice(0, 500)}</p>
                  </div>
                  <div>
                    <strong>Notion</strong>
                    <p className="whitespace-pre-wrap">{c.notion.body.slice(0, 500)}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await resolveNotionConflict({
                          data: { workspaceId, mappingId: c.mappingId, keep: "mellox" },
                        });
                        setConflicts(
                          (all) => all?.filter((item) => item.mappingId !== c.mappingId) ?? null,
                        );
                      }, "Mellox version kept")
                    }
                  >
                    Keep Mellox
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy || ["scheduled", "publishing", "published"].includes(c.mellox.status)
                    }
                    onClick={() =>
                      void run(async () => {
                        await resolveNotionConflict({
                          data: { workspaceId, mappingId: c.mappingId, keep: "notion" },
                        });
                        setConflicts(
                          (all) => all?.filter((item) => item.mappingId !== c.mappingId) ?? null,
                        );
                        emitAppEvent("content:changed");
                      }, "Notion version kept")
                    }
                  >
                    Keep Notion
                  </Button>
                </div>
                {["scheduled", "publishing", "published"].includes(c.mellox.status) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Return this item to draft in Mellox before keeping the Notion version.
                  </p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Notion?</AlertDialogTitle>
            <AlertDialogDescription>
              Disconnecting Notion stops future syncing. Existing content in Mellox and Notion will
              not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await disconnectNotion({ data: { workspaceId } });
                  setDisconnectOpen(false);
                }, "Notion disconnected")
              }
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
