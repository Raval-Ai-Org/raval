"use client";

import { RepoOwnershipCard } from "./RepoOwnershipCard";

// GitHubConnector — connect the repository behind a workspace's website.
// Connecting happens on GitHub in this tab; /integrations/github/callback saves
// the connection and returns here with ?github=connected. Everything else —
// repositories, selection, verification, inspection, disconnect — goes through
// server functions that hold the GitHub credentials. No token or key ever
// reaches this component, and "Connected" is only ever read from the server.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Code,
  ExternalLink,
  Eye,
  GitCommit,
  Github,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Spinner,
  Trash,
  User,
} from "@/components/icons";
import { SiteLogo } from "@/components/brand/SiteLogos";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { ConnectionCard, ConnectionFact, ConnectionSkeleton } from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  disconnectConnection,
  getConnectors,
  inspectSource,
  listGithubRepositories,
  removeSource,
  selectGithubRepository,
  updateSource,
  verifyConnection,
} from "@/lib/connectors.functions";
import { useGithubInstall } from "./useGithubInstall";
import { takeGithubConnected } from "@/lib/connectors/github-return";
import type {
  ConnectionView,
  ConnectorsOverview,
  RepositoryOption,
  SourceView,
} from "@/lib/connectors/types";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StatusChip({
  tone,
  children,
}: {
  tone: "success" | "warning" | "destructive" | "muted";
  children: React.ReactNode;
}) {
  const tones = {
    success: "bg-success/10 text-success ring-success/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    destructive: "bg-destructive/10 text-destructive ring-destructive/25",
    muted: "bg-muted text-muted-foreground ring-border/60",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function connectionHealth(c: ConnectionView) {
  switch (c.status) {
    case "active":
      return { tone: "success" as const, label: "Connected" };
    case "suspended":
      return { tone: "warning" as const, label: "Suspended on GitHub" };
    case "error":
      return { tone: "destructive" as const, label: "Needs attention" };
    default:
      return {
        tone: "muted" as const,
        label:
          c.revokedReason === "uninstalled_on_github" ? "Uninstalled on GitHub" : "Disconnected",
      };
  }
}

/* ───────────────────────── Repository picker ───────────────────────── */

export function RepositoryPicker({
  workspaceId,
  connection,
  selectedIds,
  canManage,
  onSelected,
  siteUrl,
}: {
  workspaceId: string;
  connection: ConnectionView;
  selectedIds: Set<string>;
  canManage: boolean;
  onSelected: (source: SourceView) => void;
  /** Link the chosen repository to this website instead of the repository's homepage. */
  siteUrl?: string;
}) {
  const [repos, setRepos] = useState<RepositoryOption[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRepos(null);
    setError(null);
    listGithubRepositories({ data: { workspaceId, connectionId: connection.id } })
      .then((r) => {
        if (cancelled) return;
        setRepos(r.repositories);
        setMeta({ total: r.total, truncated: r.truncated });
      })
      .catch(
        (e) =>
          !cancelled && setError(e instanceof Error ? e.message : "Couldn't load repositories"),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, connection.id, nonce]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter(
      (r) =>
        !q ||
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, query]);

  const select = async (repo: RepositoryOption) => {
    setBusy(repo.id);
    try {
      const source = await selectGithubRepository({
        data: {
          workspaceId,
          connectionId: connection.id,
          repositoryId: repo.id,
          siteUrl: siteUrl ?? repo.homepage,
        },
      });
      onSelected(source);
      toast.success(`${repo.fullName} connected`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't connect that repository");
    } finally {
      setBusy(null);
    }
  };

  if (error)
    return (
      <ErrorState
        size="sm"
        title="Repositories didn't load"
        detail={error}
        onRetry={() => setNonce((n) => n + 1)}
      />
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Search repositories</span>
          <Search className="pointer-events-none absolute z-10 left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search repositories"
            className="h-9 pl-8 text-[13px]"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Refresh repositories"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      {!repos ? (
        <div className="space-y-1.5" aria-label="Loading repositories">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : repos.length === 0 ? (
        <EmptyState
          size="sm"
          icon={Github}
          title="No repositories shared yet"
          description="Choose which ones Mellox can see on GitHub."
          action={
            connection.manageUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={connection.manageUrl} target="_blank" rel="noopener noreferrer">
                  Open GitHub <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="ds-well max-h-72 divide-y divide-[var(--ds-tile-border)] overflow-y-auto">
            {visible.map((repo) => {
              const selected = selectedIds.has(repo.id);
              return (
                <li key={repo.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                      <span className="truncate">{repo.fullName}</span>
                      {repo.private && (
                        <Lock
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                          aria-label="Private"
                        />
                      )}
                      {repo.archived && <StatusChip tone="muted">Archived</StatusChip>}
                    </div>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {repo.defaultBranch}
                      {repo.pushedAt ? ` · updated ${timeAgo(repo.pushedAt)}` : ""}
                      {repo.description ? ` · ${repo.description}` : ""}
                    </p>
                  </div>
                  {selected ? (
                    <StatusChip tone="success">
                      <CheckCircle className="h-3 w-3" /> Connected
                    </StatusChip>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || busy !== null}
                      loading={busy === repo.id}
                      onClick={() => void select(repo)}
                    >
                      Connect
                    </Button>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                No repositories match “{query}”.
              </li>
            )}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            {meta?.truncated
              ? `Showing ${repos.length} of ${meta.total}`
              : `${repos.length} repositories`}
          </p>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Connected source ───────────────────────── */

function SourceCard({
  workspaceId,
  source,
  canManage,
  onChange,
  onRemoved,
}: {
  workspaceId: string;
  source: SourceView;
  canManage: boolean;
  onChange: (s: SourceView) => void;
  onRemoved: (id: string) => void;
}) {
  const [siteUrl, setSiteUrl] = useState(source.siteUrl ?? "");
  const [branch, setBranch] = useState(source.branch ?? "");
  const [busy, setBusy] = useState<"inspect" | "save" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty =
    siteUrl.trim() !== (source.siteUrl ?? "") || branch.trim() !== (source.branch ?? "");
  const inspection = source.inspection;

  const run = async (kind: "inspect" | "save" | "remove") => {
    setBusy(kind);
    try {
      if (kind === "inspect") {
        onChange(await inspectSource({ data: { workspaceId, sourceId: source.id } }));
        toast.success("Repository inspected");
      } else if (kind === "save") {
        const updated = await updateSource({
          data: {
            workspaceId,
            sourceId: source.id,
            siteUrl: siteUrl.trim() || null,
            branch: branch.trim() || null,
          },
        });
        onChange(updated);
        setSiteUrl(updated.siteUrl ?? "");
        setBranch(updated.branch ?? "");
        toast.success("Source updated");
      } else {
        await removeSource({ data: { workspaceId, sourceId: source.id } });
        onRemoved(source.id);
        toast.success(`${source.fullName} removed from Mellox`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  };

  const lost = source.status === "access_lost";
  return (
    <li className="ds-well p-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background text-foreground ring-1 ring-[var(--ds-tile-border)]">
          <Code className="size-4" />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex min-w-0 items-center gap-1.5">
            {source.htmlUrl ? (
              <a
                href={source.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[13.5px] font-semibold underline-offset-2 hover:underline"
              >
                {source.fullName}
              </a>
            ) : (
              <span className="truncate text-[13.5px] font-semibold">{source.fullName}</span>
            )}
            {source.private && (
              <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Private" />
            )}
            {lost && (
              <StatusChip tone="destructive">
                <AlertTriangle className="h-3 w-3" /> Access lost
              </StatusChip>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {source.branch ?? source.defaultBranch ?? "—"}
            {source.siteUrl
              ? ` · ${source.siteUrl.replace(/^https?:\/\//, "")}`
              : " · no website yet"}
            {` · ${timeAgo(source.lastSyncedAt)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || lost}
            loading={busy === "inspect"}
            onClick={() => void run("inspect")}
          >
            <Search className="h-3.5 w-3.5" /> Check code
          </Button>
          {canManage && (
            <button
              type="button"
              className={dsIconBtn}
              aria-label={`Remove ${source.fullName}`}
              disabled={busy !== null}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {lost && (
        <p className="mt-3 text-[12px] text-destructive">
          Mellox can&apos;t read this repository any more. Share it again on GitHub.
        </p>
      )}
      {source.lastError && !lost && (
        <p className="mt-3 text-[12px] text-destructive">{source.lastError}</p>
      )}
      {source.siteUrl && !lost && (
        <div className="mt-3">
          <RepoOwnershipCard
            workspaceId={workspaceId}
            source={source}
            canVerify
            canAttest={canManage}
            onChange={onChange}
            compact
          />
        </div>
      )}

      {canManage && (
        <form
          data-no-rhythm
          className="mt-3 grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save");
          }}
        >
          <Input
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="Website (example.com)"
            aria-label="Website this repository builds"
            className="h-9 text-[13px]"
          />
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={`Branch (${source.defaultBranch ?? "main"})`}
            aria-label="Branch"
            className="h-9 text-[13px]"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!dirty || busy !== null}
            loading={busy === "save"}
          >
            Save
          </Button>
        </form>
      )}

      {inspection && (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: "Built with",
              value: inspection.framework,
              title: inspection.frameworkEvidence,
            },
            { label: "robots.txt", value: inspection.discoveryFiles.robots },
            { label: "Sitemap", value: inspection.discoveryFiles.sitemap },
            { label: "llms.txt", value: inspection.discoveryFiles.llms },
          ].map((item) => (
            <div
              key={item.label}
              className="min-w-0 rounded-[12px] bg-background px-3 py-2 ring-1 ring-[var(--ds-tile-border)]"
              title={item.title ?? item.value ?? undefined}
            >
              <dt className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.value ? "bg-success" : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                {item.label}
              </dt>
              <dd className="mt-0.5 truncate text-[12.5px] font-medium text-foreground">
                {item.value ?? "Not found"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <DisconnectDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        name={source.fullName}
        description="Mellox stops using this repository. Nothing changes on GitHub."
        busy={busy === "remove"}
        onConfirm={() => void run("remove")}
      />
    </li>
  );
}

/* ───────────────────────── Connector ───────────────────────── */

export function GitHubConnector({ workspaceId }: { workspaceId: string }) {
  const [overview, setOverview] = useState<ConnectorsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await getConnectors({ data: { workspaceId } }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load integrations");
    }
  }, [workspaceId]);

  useEffect(() => {
    setOverview(null);
    void load();
  }, [load]);

  const { installing, install } = useGithubInstall(workspaceId);
  const [justConnected, setJustConnected] = useState<string[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Back from GitHub: the callback page saved and verified the connection. The
  // overview above is re-read from the server; go straight to choosing a repository.
  useEffect(() => {
    const notice = takeGithubConnected(workspaceId);
    if (notice) setJustConnected(notice.accounts);
  }, [workspaceId]);

  // Fallback for changes made elsewhere (another tab, GitHub's own settings).
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const verify = async (connection: ConnectionView) => {
    setBusy(`verify:${connection.id}`);
    try {
      const updated = await verifyConnection({
        data: { workspaceId, connectionId: connection.id },
      });
      toast[updated.status === "active" ? "success" : "error"](
        updated.status === "active" ? "GitHub access verified" : connectionHealth(updated).label,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (connection: ConnectionView) => {
    setBusy(`disconnect:${connection.id}`);
    try {
      await disconnectConnection({ data: { workspaceId, connectionId: connection.id } });
      toast.success(`Disconnected ${connection.accountLogin}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
    } finally {
      setBusy(null);
    }
  };

  if (error && !overview)
    return (
      <ErrorState size="sm" title="GitHub didn't load" detail={error} onRetry={() => void load()} />
    );
  if (!overview) return <ConnectionSkeleton label="Loading GitHub" />;

  return (
    <GitHubView
      workspaceId={workspaceId}
      overview={overview}
      onOverviewChange={(update) => setOverview((o) => (o ? update(o) : o))}
      busy={busy}
      installing={installing}
      refreshing={refreshing}
      justConnected={justConnected !== null}
      onInstall={() => void install()}
      onRefresh={() => void refresh()}
      onVerify={(connection) => void verify(connection)}
      onDisconnect={(connection) => void disconnect(connection)}
    />
  );
}

/** The GitHub card. Presentational apart from the repository rows it contains. */
export function GitHubView({
  workspaceId,
  overview,
  onOverviewChange,
  busy,
  installing,
  refreshing,
  justConnected = false,
  onInstall,
  onRefresh,
  onVerify,
  onDisconnect,
}: {
  workspaceId: string;
  overview: ConnectorsOverview;
  onOverviewChange: (update: (overview: ConnectorsOverview) => ConnectorsOverview) => void;
  busy: string | null;
  installing: boolean;
  refreshing: boolean;
  /** Just back from GitHub: open straight onto choosing a repository. */
  justConnected?: boolean;
  onInstall: () => void;
  onRefresh: () => void;
  onVerify: (connection: ConnectionView) => void;
  onDisconnect: (connection: ConnectionView) => void;
}) {
  const config = overview.configured.github;
  const connections = overview.connections.filter((c) => c.provider === "github");
  const live = connections.filter((c) => c.status !== "revoked");
  const past = connections.filter((c) => c.status === "revoked");
  const sources = overview.sources.filter((s) => s.provider === "github");
  const selectedIds = new Set(sources.map((s) => s.externalId));
  const canManage = overview.canManage;
  const healthy = live.every((c) => c.status === "active");
  const lost = sources.some((s) => s.status === "access_lost");

  // Open by itself only while there is something to do: pick a repository.
  const [open, setOpen] = useState(justConnected || (live.length > 0 && sources.length === 0));
  const [showPicker, setShowPicker] = useState(justConnected);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ConnectionView | null>(null);
  useEffect(() => {
    if (!justConnected) return;
    setOpen(true);
    setShowPicker(true);
  }, [justConnected]);

  const logo = <SiteLogo provider="github" size={24} />;
  const notReady = !config.ready
    ? `GitHub isn't set up on this server yet. ${config.issues.slice(0, 2).join(" · ")}`
    : undefined;

  if (live.length === 0)
    return (
      <ConnectionCard
        label="GitHub connection"
        logo={logo}
        name="GitHub"
        description="The code behind your website"
        status={{ tone: "off", text: "Not connected" }}
        facts={
          <>
            <ConnectionFact icon={Eye}>Reads your site&apos;s code</ConnectionFact>
            <ConnectionFact icon={GitCommit}>Suggests fixes you approve</ConnectionFact>
            <ConnectionFact icon={Lock}>Never merges by itself</ConnectionFact>
          </>
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={onInstall}
            disabled={!config.ready || !canManage}
            loading={installing}
          >
            {past.length ? "Reconnect" : "Connect"}
          </Button>
        }
        note={
          notReady ??
          (!canManage
            ? "Ask an admin to connect GitHub."
            : config.installVerification === "install_window"
              ? "Development mode: installs are checked by timing."
              : undefined)
        }
      />
    );

  return (
    <>
      <ConnectionCard
        label="GitHub connection"
        logo={logo}
        name="GitHub"
        description={
          sources.length
            ? sources.map((s) => s.fullName).join(", ")
            : "Choose the repository that builds your website"
        }
        status={
          !healthy || lost
            ? { tone: "attention", text: "Needs attention" }
            : sources.length
              ? { tone: "connected", text: "Connected" }
              : { tone: "attention", text: "Choose a repository" }
        }
        facts={
          <>
            {live.map((c) => (
              <ConnectionFact key={c.id} icon={User}>
                {c.accountLogin}
              </ConnectionFact>
            ))}
            {sources.length > 0 && (
              <ConnectionFact icon={Code}>
                {sources.length === 1 ? "1 repository" : `${sources.length} repositories`}
              </ConnectionFact>
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className={dsIconBtn}
              aria-label="Refresh GitHub status"
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
            <Button
              size="sm"
              variant={open ? "ghost" : "outline"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Close" : "Manage"}
            </Button>
          </>
        }
        note={notReady}
      >
        {open && (
          <div className="space-y-6">
            {live.map((connection) => {
              const health = connectionHealth(connection);
              const mine = sources.filter((s) => s.connectionId === connection.id);
              const canOpenPrs =
                connection.permissions.contents === "write" &&
                connection.permissions.pull_requests === "write";
              return (
                <div key={connection.id} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {connection.accountAvatarUrl ? (
                      <img
                        src={connection.accountAvatarUrl}
                        alt=""
                        className="size-9 shrink-0 rounded-full ring-1 ring-[var(--ds-tile-border)]"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-[13px] font-semibold">
                        {connection.accountLogin.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-semibold">
                          {connection.accountLogin}
                        </span>
                        <StatusChip tone={health.tone}>{health.label}</StatusChip>
                        {connection.verification === "oauth" && (
                          <ShieldCheck
                            className="size-3.5 text-success"
                            aria-label="Verified owner"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {connection.repositorySelection === "all"
                          ? "All repositories"
                          : "Selected repositories"}{" "}
                        · checked {timeAgo(connection.lastVerifiedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={dsIconBtn}
                        aria-label={`Check access for ${connection.accountLogin}`}
                        title="Check access"
                        disabled={busy !== null}
                        onClick={() => onVerify(connection)}
                      >
                        {busy === `verify:${connection.id}` ? (
                          <Spinner className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </button>
                      {connection.manageUrl && (
                        <a
                          className={dsIconBtn}
                          href={connection.manageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Manage on GitHub (opens in a new tab)"
                          title="Manage on GitHub"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => setConfirmDisconnect(connection)}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  </div>

                  {!canOpenPrs && (
                    <p className="flex items-start gap-2 text-[12px] text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      Mellox can&apos;t open pull requests here. Allow Contents and Pull requests on
                      GitHub.
                    </p>
                  )}
                  {connection.status === "suspended" && (
                    <p className="flex items-start gap-2 text-[12px] text-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      Paused on GitHub. Turn it back on there, then check access.
                    </p>
                  )}
                  {connection.status === "error" && connection.lastError && (
                    <p className="flex items-start gap-2 text-[12px] text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        {connection.lastError}
                        {canManage && (
                          <button
                            type="button"
                            onClick={onInstall}
                            className="ml-1.5 font-medium underline underline-offset-2"
                          >
                            Reconnect
                          </button>
                        )}
                      </span>
                    </p>
                  )}

                  {connection.status === "active" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="ds-label">Repositories</p>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowPicker((v) => !v)}
                          >
                            {showPicker ? (
                              <>
                                <Check className="h-3.5 w-3.5" /> Done
                              </>
                            ) : (
                              <>
                                <Plus className="h-3.5 w-3.5" /> Add
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      {mine.length === 0 && !showPicker && (
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => setShowPicker(true)}
                          className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-dashed border-[var(--ds-tile-border)] px-3 py-4 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none"
                        >
                          <Plus className="h-4 w-4" /> Add the repository that builds your website
                        </button>
                      )}
                      <ul className="space-y-2">
                        {mine.map((source) => (
                          <SourceCard
                            key={source.id}
                            workspaceId={workspaceId}
                            source={source}
                            canManage={canManage}
                            onChange={(updated) =>
                              onOverviewChange((o) => ({
                                ...o,
                                sources: o.sources.map((s) => (s.id === updated.id ? updated : s)),
                              }))
                            }
                            onRemoved={(id) =>
                              onOverviewChange((o) => ({
                                ...o,
                                sources: o.sources.filter((s) => s.id !== id),
                              }))
                            }
                          />
                        ))}
                      </ul>
                      <AnimatePresence initial={false}>
                        {showPicker && canManage && (
                          <motion.div
                            key="picker"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <RepositoryPicker
                              workspaceId={workspaceId}
                              connection={connection}
                              selectedIds={selectedIds}
                              canManage={canManage}
                              onSelected={(source) =>
                                onOverviewChange((o) => ({
                                  ...o,
                                  sources: [...o.sources.filter((s) => s.id !== source.id), source],
                                }))
                              }
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              );
            })}

            {(canManage && config.ready) || past.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ds-tile-border)] pt-4">
                {canManage && config.ready && (
                  <Button size="sm" variant="ghost" onClick={onInstall} loading={installing}>
                    <Plus className="h-3.5 w-3.5" /> Add another account
                  </Button>
                )}
                {past.map((connection) => (
                  <ConnectionFact
                    key={connection.id}
                    title={`${connectionHealth(connection).label} ${timeAgo(connection.revokedAt)}`}
                  >
                    {connection.accountLogin} · removed
                  </ConnectionFact>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </ConnectionCard>
      <DisconnectDialog
        open={confirmDisconnect !== null}
        onOpenChange={(v) => {
          if (!v) setConfirmDisconnect(null);
        }}
        name={confirmDisconnect?.accountLogin ?? "GitHub"}
        description="Mellox stops using its repositories. The app stays on GitHub until you remove it there."
        busy={busy !== null}
        onConfirm={() => {
          if (confirmDisconnect) onDisconnect(confirmDisconnect);
          setConfirmDisconnect(null);
        }}
      />
    </>
  );
}
