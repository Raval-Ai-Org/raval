"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";

import {
  Bell,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  Loader2,
  Radio,
  AlertTriangle,
  Sparkles,
  FileText,
  Tag,
  Megaphone,
  MousePointerClick,
} from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";
import { AppModalShell } from "@/components/app/AppModalShell";
import {
  listCompetitorWatches,
  addCompetitorWatch,
  removeCompetitorWatch,
  toggleCompetitorWatch,
  runCompetitorWatchNow,
  listCompetitorAlerts,
  markCompetitorAlertsRead,
  type CompetitorWatch,
  type CompetitorAlert,
} from "@/lib/competitor-watch.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const kindIcon: Record<CompetitorAlert["kind"], typeof Sparkles> = {
  new_page: FileText,
  promotion: Megaphone,
  positioning: Sparkles,
  title: Tag,
  cta: MousePointerClick,
};
const kindLabel: Record<CompetitorAlert["kind"], string> = {
  new_page: "New page",
  promotion: "Promotion",
  positioning: "Positioning shift",
  title: "Title change",
  cta: "New CTA",
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function CompetitorWatchButton({ workspaceId }: { workspaceId: string | null }) {
  const [unread, setUnread] = useState(0);
  const [alerts, setAlerts] = useState<CompetitorAlert[]>([]);
  const [watches, setWatches] = useState<CompetitorWatch[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [popOpen, setPopOpen] = useState(false);

  const fetchAlerts = useServerFn(listCompetitorAlerts);
  const fetchWatches = useServerFn(listCompetitorWatches);
  const markRead = useServerFn(markCompetitorAlertsRead);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [a, w] = await Promise.all([
        fetchAlerts({ data: { workspaceId, limit: 30 } }),
        fetchWatches({ data: { workspaceId } }),
      ]);
      setAlerts(Array.isArray(a) ? a : []);
      setWatches(Array.isArray(w) ? w : []);
      setUnread(Array.isArray(a) ? a.filter((x) => !x.read_at).length : 0);
    } catch {
      /* ignore */
    }
  }, [workspaceId, fetchAlerts, fetchWatches]);

  useEffect(() => {
    if (!workspaceId) return;
    refresh();
    const t = document.hidden ? 0 : window.setInterval(refresh, 300_000);
    const onVis = () => {
      if (document.hidden) {
        if (t) window.clearInterval(t);
      } else {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const openHandler = () => setManageOpen(true);
    window.addEventListener("open:competitor-watch", openHandler);
    return () => {
      if (t) window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("open:competitor-watch", openHandler);
    };
  }, [workspaceId, refresh]);

  const markAllRead = useCallback(async () => {
    if (!workspaceId || unread === 0) return;
    setUnread(0);
    setAlerts((prev) =>
      prev.map((a) => (a.read_at ? a : { ...a, read_at: new Date().toISOString() })),
    );
    try {
      await markRead({ data: { workspaceId } });
    } catch {
      /* ignore */
    }
  }, [workspaceId, unread, markRead]);

  if (!workspaceId) return null;

  return (
    <>
      <Popover
        open={popOpen}
        onOpenChange={(open) => {
          setPopOpen(open);
          if (open) {
            refresh();
            markAllRead();
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Competitor alerts"
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-secondary/40 text-foreground/80 transition hover:bg-secondary hover:text-foreground"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-[hsl(var(--brand-green))] px-1 text-[9px] font-bold text-black">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <Radio className="h-3.5 w-3.5 text-[hsl(var(--brand-green))]" />
              Competitor alerts
            </div>
            <button
              type="button"
              onClick={() => {
                setPopOpen(false);
                setManageOpen(true);
              }}
              className="text-[11px] font-medium text-foreground/70 hover:text-foreground"
            >
              Manage
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                {watches.length === 0 ? (
                  <>
                    No competitors tracked yet.
                    <button
                      type="button"
                      onClick={() => {
                        setPopOpen(false);
                        setManageOpen(true);
                      }}
                      className="mt-2 block w-full rounded-md bg-foreground px-2 py-1.5 text-[11.5px] font-medium text-background hover:opacity-90"
                    >
                      Add a competitor
                    </button>
                  </>
                ) : (
                  "All caught up — no changes since last check."
                )}
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {alerts.map((a) => {
                  const Icon = kindIcon[a.kind] ?? Sparkles;
                  return (
                    <li key={a.id} className="px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                            a.severity === "warning"
                              ? "bg-amber-500/15 text-amber-500"
                              : a.severity === "critical"
                                ? "bg-rose-500/15 text-rose-500"
                                : "bg-foreground/8 text-foreground/70",
                          )}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-[12px] font-semibold text-foreground">
                              {a.title}
                            </div>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {fmtWhen(a.detected_at)}
                            </span>
                          </div>
                          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80">
                            {kindLabel[a.kind]} · {hostOf(a.source_url)}
                          </div>
                          {a.detail && (
                            <div className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                              {a.detail}
                            </div>
                          )}
                          {a.source_url && (
                            <a
                              href={a.source_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-foreground/70 hover:text-foreground"
                            >
                              Open <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        workspaceId={workspaceId}
        watches={watches}
        onChanged={refresh}
      />
    </>
  );
}

function ManageDialog({
  open,
  onOpenChange,
  workspaceId,
  watches,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  watches: CompetitorWatch[];
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addFn = useServerFn(addCompetitorWatch);
  const removeFn = useServerFn(removeCompetitorWatch);
  const toggleFn = useServerFn(toggleCompetitorWatch);
  const runNowFn = useServerFn(runCompetitorWatchNow);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addFn({ data: { workspaceId, url: url.trim(), name: name.trim() || null } });
      setUrl("");
      setName("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      await removeFn({ data: { id } });
      onChanged();
    } finally {
      setBusyId(null);
    }
  };
  const handleToggle = async (id: string, enabled: boolean) => {
    setBusyId(id);
    try {
      await toggleFn({ data: { id, enabled } });
      onChanged();
    } finally {
      setBusyId(null);
    }
  };
  const handleRunNow = async (id: string) => {
    setBusyId(id);
    try {
      await runNowFn({ data: { id } });
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      Icon={Radio}
      eyebrow="Intelligence"
      title="Competitor watch"
      description={
        watches.length > 0
          ? `${watches.filter((w) => w.enabled).length} active · ${watches.length} tracked · scans every 30 min`
          : "Scans tracked sites every 30 minutes for changes."
      }
      srDescription="Track competitor sites and get alerts on changes."
      bodyClassName="px-4 py-5 sm:px-6"
    >
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {/* Add form */}
        <form
          onSubmit={handleAdd}
          className="rounded-2xl bg-secondary/40 p-3.5 ring-1 ring-inset ring-border/40"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,180px]">
            <div className="relative">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://competitor.com"
                className="w-full rounded-lg bg-background px-3 py-2 text-[13px] outline-none ring-1 ring-inset ring-border/50 transition focus:ring-2 focus:ring-[hsl(var(--brand-green)/0.5)]"
              />
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="rounded-lg bg-background px-3 py-2 text-[13px] outline-none ring-1 ring-inset ring-border/50 transition focus:ring-2 focus:ring-[hsl(var(--brand-green)/0.5)]"
            />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3 shrink-0 text-[hsl(var(--brand-green))]" />
              <span className="truncate">First scan runs immediately as a baseline</span>
            </div>
            <button
              type="submit"
              disabled={adding || !url.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[hsl(var(--brand-green))] px-3.5 py-1.5 text-[12px] font-semibold text-background shadow-[0_4px_14px_-6px_hsl(var(--brand-green)/0.6)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Track site
            </button>
          </div>
          {error && (
            <div className="mt-2 flex items-center gap-1.5 rounded-md bg-rose-500/10 px-2 py-1.5 text-[11.5px] text-rose-500">
              <AlertTriangle className="h-3 w-3 shrink-0" /> {error}
            </div>
          )}
        </form>

        {/* List */}
        <div className="max-h-[380px] overflow-y-auto rounded-2xl ring-1 ring-inset ring-border/40">
          {watches.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary/60 text-muted-foreground">
                <Radio className="h-[18px] w-[18px]" />
              </div>
              <div className="text-[13px] font-medium text-foreground">
                No competitors tracked yet
              </div>
              <div className="max-w-[280px] text-[11.5px] leading-relaxed text-muted-foreground">
                Add a competitor URL above to start watching for changes automatically.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {watches.map((w) => (
                <li
                  key={w.id}
                  className="group flex items-center gap-2 px-3.5 py-3 transition-colors hover:bg-secondary/30"
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary/60 text-[11px] font-semibold text-foreground/80">
                    {(w.name || hostOf(w.url) || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {w.name || hostOf(w.url)}
                      </span>
                      {!w.enabled && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                          Paused
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {hostOf(w.url)}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground/80">
                      {w.last_error ? (
                        <span className="inline-flex items-center gap-1 text-rose-500">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {w.last_error}
                        </span>
                      ) : w.last_checked_at ? (
                        <>Last checked {fmtWhen(w.last_checked_at)}</>
                      ) : (
                        "Not scanned yet"
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={busyId === w.id}
                      onClick={() => handleRunNow(w.id)}
                      className="rounded-md p-1.5 text-foreground/70 transition hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      aria-label="Scan now"
                      title="Scan now"
                    >
                      {busyId === w.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === w.id}
                      onClick={() => handleToggle(w.id, !w.enabled)}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-foreground/70 transition hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      title={w.enabled ? "Pause" : "Resume"}
                    >
                      {w.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === w.id}
                      onClick={() => handleRemove(w.id)}
                      className="rounded-md p-1.5 text-rose-500/80 transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                      aria-label="Remove"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppModalShell>
  );
}
