"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { NotionMark } from "@/components/brand/AppMarks";
import { ConnectionCard, ConnectionFact } from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Clock, Database, ExternalLink, MoreHorizontal, RefreshCw, User } from "@/components/icons";
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
  if (!Number.isFinite(minutes)) return "Not synced yet";
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${new Date(value).toLocaleDateString()}`;
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
  const [destinations, setDestinations] = useState<Destination[] | null>(null);
  const [addTo, setAddTo] = useState<Destination | null>(null);
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
    setDestinations(null);
    setAddTo(null);
    void listNotionDestinations({ data: { workspaceId } })
      .then(setDestinations)
      .catch((cause) => {
        if (
          cause instanceof ServerFnError &&
          cause.status === 409 &&
          /reconnect/i.test(cause.message)
        )
          setStatus((current) => (current ? { ...current, status: "error" } : current));
        setError(cause instanceof Error ? cause.message : "Could not load your Notion pages.");
        setDestinations([]);
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
  const pages = (destinations ?? []).filter((d) => d.kind === "page");
  const sources = (destinations ?? []).filter((d) => d.kind === "data_source");
  const needsAttention = status?.status === "error";
  const actions = !connected ? (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !canEdit || !status?.configured}
        onClick={connect}
      >
        {needsAttention ? "Reconnect" : "Connect"}
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
      {status.dataSourceId ? (
        <Button size="sm" variant="outline" disabled={busy || !canEdit} onClick={sync}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Sync
        </Button>
      ) : (
        <Button size="sm" disabled={busy || !canEdit} onClick={() => setSetup(true)}>
          Choose database
        </Button>
      )}
      {status.destinationUrl && (
        <a
          className={cn(dsGhostBtn, "h-8 px-3 text-xs")}
          href={status.destinationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open <ExternalLink className="size-3.5" />
          <span className="sr-only">in Notion (opens in a new tab)</span>
        </a>
      )}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="More Notion actions" disabled={busy}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {status.dataSourceId && (
              <>
                <DropdownMenuItem onSelect={openPreview}>Import from Notion</DropdownMenuItem>
                <DropdownMenuItem onSelect={exportItems}>Export to Notion</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSetup(true)}>Change database</DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={() => setDisconnectOpen(true)}>Disconnect</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
              className={cn(dsGhostBtn, "h-8 gap-1.5 px-2 text-[12px] sm:px-3")}
              aria-label="Notion calendar actions"
            >
              <NotionMark className="size-4" />
              <span className="hidden sm:inline">Notion{connected ? " ✓" : ""}</span>
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
        <ConnectionCard
          label="Notion connection"
          logo={<NotionMark />}
          name="Notion"
          description="Your content calendar, in Notion too"
          status={
            status
              ? connected
                ? busy
                  ? { tone: "connected", text: "Syncing" }
                  : result?.conflicts
                    ? { tone: "attention", text: "Needs a decision" }
                    : !status.dataSourceId
                      ? { tone: "attention", text: "Choose a database" }
                      : { tone: "connected", text: "Connected" }
                : needsAttention
                  ? { tone: "attention", text: "Reconnect needed" }
                  : { tone: "off", text: "Not connected" }
              : error
                ? { tone: "off", text: "Unavailable" }
                : null
          }
          facts={
            connected ? (
              <>
                {status.workspaceName && (
                  <ConnectionFact icon={User}>{status.workspaceName}</ConnectionFact>
                )}
                {status.destinationName && (
                  <ConnectionFact icon={Database}>{status.destinationName}</ConnectionFact>
                )}
                {status.dataSourceId && (
                  <ConnectionFact icon={Clock}>
                    {status.lastSyncAt ? relativeSyncTime(status.lastSyncAt) : "Not synced yet"}
                  </ConnectionFact>
                )}
              </>
            ) : undefined
          }
          actions={actions}
          note={
            status && !status.configured
              ? (status.configurationMessage ?? "Notion is not set up on this server yet.")
              : undefined
          }
          error={error}
        />
      )}
      <Dialog open={setup} onOpenChange={setSetup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose your Notion calendar</DialogTitle>
            <DialogDescription>
              Mellox keeps your posts in one Notion database. Make a new one, or use one you have.
            </DialogDescription>
          </DialogHeader>
          {!destinations ? (
            <div className="space-y-2" role="status" aria-busy="true">
              <span className="ds-well block h-11 animate-pulse rounded-xl" />
              <span className="ds-well block h-11 animate-pulse rounded-xl" />
            </div>
          ) : !destinations.length ? (
            <div className="ds-well rounded-2xl p-4 text-sm">
              <p className="font-medium">Mellox can’t see any Notion pages yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Notion asks which pages to share when you connect. Pick at least one page.
              </p>
              <Button size="sm" className="mt-3" disabled={busy} onClick={connect}>
                Choose pages in Notion
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="ds-label">New calendar</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mellox adds a “Mellox Content Calendar” database inside the page you pick.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    aria-label="Page for the new calendar"
                    className="ds-well min-h-9 min-w-0 flex-1 rounded-xl px-3 text-sm"
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                  >
                    <option value="">Choose a page</option>
                    {pages.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={busy || !parentId}
                    onClick={() =>
                      void run(async () => {
                        await createNotionDestination({
                          data: { workspaceId, parentPageId: parentId },
                        });
                        setSetup(false);
                      }, "Notion calendar created")
                    }
                  >
                    Create calendar
                  </Button>
                </div>
                {!pages.length && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No pages are shared with Mellox yet.
                  </p>
                )}
              </div>
              {sources.length > 0 && (
                <div>
                  <p className="ds-label">Use a database you have</p>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                    {sources.map((d) => {
                      const fit = d.fit ?? "ready";
                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled={busy || fit === "unfit"}
                          className="ds-tile ds-tile-hover flex w-full items-center justify-between gap-3 p-3 text-left text-sm disabled:opacity-60"
                          onClick={() =>
                            fit === "addable"
                              ? setAddTo(d)
                              : void run(async () => {
                                  await selectNotionDestination({
                                    data: { workspaceId, dataSourceId: d.id },
                                  });
                                  setSetup(false);
                                }, "Notion calendar selected")
                          }
                        >
                          <span className="min-w-0 truncate font-medium">{d.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {fit === "ready"
                              ? "Ready"
                              : fit === "addable"
                                ? "Needs Mellox columns"
                                : "Needs a “Name” title column"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {addTo && (
                    <div className="ds-well mt-2 rounded-2xl p-3 text-sm">
                      <p>
                        Add the Mellox columns to <strong>{addTo.name}</strong>? Your own columns
                        and rows stay as they are.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await selectNotionDestination({
                                data: { workspaceId, dataSourceId: addTo.id, addColumns: true },
                              });
                              setSetup(false);
                            }, "Notion calendar selected")
                          }
                        >
                          Add columns and use it
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAddTo(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Don’t see it?{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={connect}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Choose pages in Notion
                </button>
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
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
      <DisconnectDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        name="Notion"
        description="Syncing stops. Nothing in Mellox or Notion is deleted."
        busy={busy}
        onConfirm={() =>
          void run(async () => {
            await disconnectNotion({ data: { workspaceId } });
            setDisconnectOpen(false);
          }, "Notion disconnected")
        }
      />
    </>
  );
}
