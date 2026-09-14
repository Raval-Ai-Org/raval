"use client";

// GitHubConnector — connect the repository behind a workspace's website.
// Install happens on GitHub in a popup (/integrations/github/callback reports
// back over a BroadcastChannel); everything else — repositories, selection,
// verification, inspection, disconnect — goes through server functions that
// hold the GitHub credentials. No token or key ever reaches this component.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle,
  Code,
  ExternalLink,
  GitCommit,
  Github,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Spinner,
  Trash,
} from "@/components/icons";
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
  startGithubInstall,
  subscribeConnectors,
  updateSource,
  verifyConnection,
} from "@/lib/connectors.functions";
import type {
  ConnectionView,
  ConnectorsOverview,
  RepositoryOption,
  SourceView,
} from "@/lib/connectors/types";

const PERMISSIONS = [
  {
    label: "Read repository metadata",
    detail: "Names, branches and settings of repositories you choose.",
    icon: ShieldCheck,
  },
  {
    label: "Read repository contents",
    detail: "Files that build your site — used to inspect SEO, GEO and AEO setup.",
    icon: Code,
  },
  {
    label: "Propose changes as pull requests",
    detail:
      "Only when you approve a specific AI Visibility fix: Mellox creates a mellox/ branch and a pull request you review and merge. It never pushes to or merges your branches.",
    icon: GitCommit,
  },
  {
    label: "Read CI checks (optional)",
    detail:
      "Checks and commit statuses on Mellox's pull requests, so you can see whether they pass.",
    icon: CheckCircle,
  },
];

const PERMISSION_LABEL: Record<string, string> = {
  metadata: "Metadata",
  contents: "Contents",
  pull_requests: "Pull requests",
  checks: "Checks",
  statuses: "Commit statuses",
};

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
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
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
          title="No repositories shared with Mellox"
          description="Choose which repositories Mellox can access in the installation settings on GitHub."
          action={
            connection.manageUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={connection.manageUrl} target="_blank" rel="noopener noreferrer">
                  Configure on GitHub <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded-xl border border-border/60 bg-card/40">
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
              ? `Showing the ${repos.length} most recent of ${meta.total} repositories.`
              : `${repos.length} repositories available`}
            {connection.repositorySelection === "selected"
              ? " · limited to the repositories you shared on GitHub"
              : ""}
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

  return (
    <li className="rounded-xl border border-border/70 bg-card/60 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary">
          <Github className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {source.htmlUrl ? (
              <a
                href={source.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[13px] font-semibold underline-offset-2 hover:underline"
              >
                {source.fullName}
              </a>
            ) : (
              <span className="truncate text-[13px] font-semibold">{source.fullName}</span>
            )}
            {source.private && (
              <StatusChip tone="muted">
                <Lock className="h-3 w-3" /> Private
              </StatusChip>
            )}
            {source.status === "access_lost" ? (
              <StatusChip tone="destructive">
                <AlertTriangle className="h-3 w-3" /> Access lost
              </StatusChip>
            ) : (
              <StatusChip tone="success">Readable</StatusChip>
            )}
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Branch {source.branch ?? source.defaultBranch ?? "—"}
            {source.siteUrl
              ? ` · builds ${source.siteUrl.replace(/^https?:\/\//, "")}`
              : " · not linked to a website"}
            {` · checked ${timeAgo(source.lastSyncedAt)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || source.status === "access_lost"}
            loading={busy === "inspect"}
            onClick={() => void run("inspect")}
          >
            <Code className="h-3.5 w-3.5" /> Inspect source
          </Button>
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${source.fullName}`}
              disabled={busy !== null}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {source.status === "access_lost" && (
        <p className="mt-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          Mellox can no longer read this repository — it was removed from the installation, or
          GitHub access was revoked. Re-share it on GitHub, then verify the connection.
        </p>
      )}
      {source.lastError && source.status !== "access_lost" && (
        <p className="mt-2 text-[12px] text-destructive">{source.lastError}</p>
      )}

      {confirmRemove && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-[12px]">
          <span className="min-w-0 flex-1">
            Stop using {source.fullName} in Mellox? Nothing changes on GitHub.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            loading={busy === "remove"}
            onClick={() => void run("remove")}
          >
            Remove
          </Button>
        </div>
      )}

      {canManage && (
        <form
          className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save");
          }}
        >
          <label className="min-w-0 space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Website this repository builds
            </span>
            <Input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="example.com"
              className="h-8 text-[12.5px]"
            />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Branch</span>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder={source.defaultBranch ?? "main"}
              className="h-8 text-[12.5px]"
            />
          </label>
          <div className="flex items-end">
            <Button
              type="submit"
              size="sm"
              disabled={!dirty || busy !== null}
              loading={busy === "save"}
            >
              Save
            </Button>
          </div>
        </form>
      )}

      {inspection && (
        <div className="mt-3 rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold">Source inspection</p>
            <p className="text-[11px] text-muted-foreground">
              {inspection.branch}
              {inspection.commitSha ? ` @ ${inspection.commitSha.slice(0, 7)}` : ""} ·{" "}
              {timeAgo(inspection.inspectedAt)}
            </p>
          </div>
          <dl className="mt-2 grid gap-1.5 text-[12px] sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Framework</dt>
              <dd className="font-medium" title={inspection.frameworkEvidence ?? undefined}>
                {inspection.framework ?? "Not detected"}
              </dd>
            </div>
            {(["robots", "sitemap", "llms"] as const).map((key) => (
              <div key={key} className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-muted-foreground">
                  {key === "llms" ? "llms.txt" : key === "robots" ? "robots" : "sitemap"}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 truncate font-mono text-[11.5px]",
                    !inspection.discoveryFiles[key] && "text-muted-foreground",
                  )}
                >
                  {inspection.discoveryFiles[key] ?? "not in repository"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">
            AI Visibility scores your live website. From a finding, “Fix this” uses this repository
            to propose a pull request you approve; the finding is resolved only after a rescan of
            the live site confirms it.
          </p>
        </div>
      )}
    </li>
  );
}

/* ───────────────────────── Connector ───────────────────────── */

export function GitHubConnector({ workspaceId }: { workspaceId: string }) {
  const [overview, setOverview] = useState<ConnectorsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

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

  // The install popup reports back here; refresh on focus as a fallback.
  useEffect(() => {
    const unsubscribe = subscribeConnectors((message) => {
      if (message.provider !== "github") return;
      setInstalling(false);
      if (message.type === "connected") {
        toast.success("GitHub connected");
        setShowPicker(true);
      } else {
        toast.error(message.message);
      }
      void load();
    });
    const onFocus = () => {
      if (installing) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [load, installing]);

  const install = async () => {
    setInstalling(true);
    // Open synchronously (popup blockers), then point it at GitHub.
    const popup = window.open(
      "about:blank",
      "mellox-github-install",
      "popup,width=1020,height=760",
    );
    try {
      const { url } = await startGithubInstall({ data: { workspaceId } });
      if (popup && !popup.closed) popup.location.href = url;
      else window.location.href = url;
    } catch (e) {
      popup?.close();
      setInstalling(false);
      toast.error(e instanceof Error ? e.message : "Couldn't start the GitHub connection");
    }
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
      setConfirmDisconnect(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
    } finally {
      setBusy(null);
    }
  };

  if (error && !overview)
    return (
      <ErrorState
        size="sm"
        title="Integrations didn't load"
        detail={error}
        onRetry={() => void load()}
      />
    );
  if (!overview) {
    return (
      <div className="space-y-2" aria-label="Loading GitHub connection">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    );
  }

  const config = overview.configured.github;
  const connections = overview.connections.filter((c) => c.provider === "github");
  const live = connections.filter((c) => c.status !== "revoked");
  const past = connections.filter((c) => c.status === "revoked");
  const sources = overview.sources.filter((s) => s.provider === "github");
  const selectedIds = new Set(sources.map((s) => s.externalId));
  const canManage = overview.canManage;

  return (
    <section aria-label="GitHub" className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-foreground text-background">
          <Github className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold">GitHub</h3>
            {live.length ? (
              <StatusChip tone="success">Connected</StatusChip>
            ) : (
              <StatusChip tone="muted">Not connected</StatusChip>
            )}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Connect the repository behind your website so Mellox can see how your SEO, GEO and AEO
            setup is built and propose approved fixes as pull requests you review.
          </p>
        </div>
      </div>

      {!config.ready && (
        <div
          className="rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3 text-[12px]"
          role="status"
        >
          <p className="font-medium text-foreground">
            GitHub isn&apos;t available on this server yet
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {config.issues.slice(0, 4).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {live.length === 0 && (
        <div className="rounded-xl border border-border/70 bg-card/50 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            What Mellox can access
          </p>
          <ul className="mt-2 space-y-2">
            {PERMISSIONS.map(({ label, detail, icon: Icon }) => (
              <li key={label} className="flex gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-[12.5px] font-medium">{label}</p>
                  <p className="text-[11.5px] text-muted-foreground">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            You pick the account and repositories on GitHub, and can revoke access there any time.
            Mellox never stores GitHub passwords or long-lived tokens.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void install()}
              disabled={!config.ready || !canManage}
              loading={installing}
            >
              <Github className="h-4 w-4" /> Connect GitHub
            </Button>
            {installing && (
              <span className="text-[12px] text-muted-foreground">
                Finish installing in the GitHub window…
              </span>
            )}
            {!canManage && (
              <span className="text-[12px] text-muted-foreground">
                Ask a workspace admin to connect GitHub.
              </span>
            )}
          </div>
          {config.installVerification === "install_window" && config.ready && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Development mode: installs are verified by timing. Configure GitHub OAuth for
              production.
            </p>
          )}
        </div>
      )}

      {live.map((connection) => {
        const health = connectionHealth(connection);
        return (
          <div
            key={connection.id}
            className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-3.5"
          >
            <div className="flex flex-wrap items-center gap-3">
              {connection.accountAvatarUrl ? (
                <img
                  src={connection.accountAvatarUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-full ring-1 ring-border"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-[13px] font-semibold">
                  {connection.accountLogin.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-semibold">
                    {connection.accountLogin}
                  </span>
                  <StatusChip tone={health.tone}>{health.label}</StatusChip>
                  {connection.verification === "oauth" && (
                    <StatusChip tone="muted">
                      <ShieldCheck className="h-3 w-3" /> Verified owner
                    </StatusChip>
                  )}
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {connection.accountType ?? "Account"} ·{" "}
                  {connection.repositorySelection === "all"
                    ? "all repositories"
                    : "selected repositories"}{" "}
                  · verified {timeAgo(connection.lastVerifiedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === `verify:${connection.id}`}
                  disabled={busy !== null}
                  onClick={() => void verify(connection)}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Verify
                </Button>
                {connection.manageUrl && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={connection.manageUrl} target="_blank" rel="noopener noreferrer">
                      Manage on GitHub <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => setConfirmDisconnect(connection.id)}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="text-muted-foreground">Permissions:</span>
              {Object.entries(connection.permissions)
                .filter(([k]) => PERMISSION_LABEL[k])
                .map(([k, v]) => (
                  <StatusChip key={k} tone={v === "write" ? "warning" : "muted"}>
                    {PERMISSION_LABEL[k]} · {v}
                  </StatusChip>
                ))}
              {(!connection.permissions.checks || !connection.permissions.statuses) && (
                <span className="text-muted-foreground">
                  CI status on fix pull requests needs Checks and Commit statuses (read).
                </span>
              )}
              {(connection.permissions.contents !== "write" ||
                connection.permissions.pull_requests !== "write") && (
                <span className="text-destructive">
                  Fix pull requests need Contents and Pull requests (write).
                </span>
              )}
            </div>

            {connection.status === "suspended" && (
              <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[12px]">
                The GitHub owner suspended this installation, so Mellox can&apos;t read
                repositories. Unsuspend it on GitHub, then press Verify.
              </p>
            )}
            {connection.status === "error" && connection.lastError && (
              <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                {connection.lastError}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void install()}
                    className="ml-1.5 font-medium underline underline-offset-2"
                  >
                    Reconnect
                  </button>
                )}
              </p>
            )}

            {confirmDisconnect === connection.id && (
              <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-[12px]">
                <p className="font-medium">
                  Disconnect {connection.accountLogin} from this workspace?
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  Mellox stops using its repositories immediately. The app stays installed on GitHub
                  until you uninstall it there
                  {connection.manageUrl ? " (Manage on GitHub)" : ""}.
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={busy === `disconnect:${connection.id}`}
                    onClick={() => void disconnect(connection)}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            )}

            {connection.status === "active" && (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold">Connected repositories</p>
                  {canManage && (
                    <Button
                      size="sm"
                      variant={showPicker ? "ghost" : "outline"}
                      onClick={() => setShowPicker((v) => !v)}
                    >
                      {showPicker ? "Done" : "Add repository"}
                    </Button>
                  )}
                </div>
                {sources.filter((s) => s.connectionId === connection.id).length === 0 &&
                  !showPicker && (
                    <p className="rounded-lg border border-dashed border-border/80 px-3 py-3 text-center text-[12px] text-muted-foreground">
                      No repository selected yet. Add the repository that builds your website.
                    </p>
                  )}
                <ul className="space-y-2">
                  {sources
                    .filter((s) => s.connectionId === connection.id)
                    .map((source) => (
                      <SourceCard
                        key={source.id}
                        workspaceId={workspaceId}
                        source={source}
                        canManage={canManage}
                        onChange={(updated) =>
                          setOverview((o) =>
                            o
                              ? {
                                  ...o,
                                  sources: o.sources.map((s) =>
                                    s.id === updated.id ? updated : s,
                                  ),
                                }
                              : o,
                          )
                        }
                        onRemoved={(id) =>
                          setOverview((o) =>
                            o ? { ...o, sources: o.sources.filter((s) => s.id !== id) } : o,
                          )
                        }
                      />
                    ))}
                </ul>
                {showPicker && canManage && (
                  <RepositoryPicker
                    workspaceId={workspaceId}
                    connection={connection}
                    selectedIds={selectedIds}
                    canManage={canManage}
                    onSelected={(source) =>
                      setOverview((o) =>
                        o
                          ? {
                              ...o,
                              sources: [...o.sources.filter((s) => s.id !== source.id), source],
                            }
                          : o,
                      )
                    }
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {live.length > 0 && canManage && config.ready && (
        <button
          type="button"
          onClick={() => void install()}
          disabled={installing}
          className="text-[12px] font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60"
        >
          {installing ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="h-3 w-3 animate-spin" /> Waiting for GitHub…
            </span>
          ) : (
            "Connect another GitHub account or organization"
          )}
        </button>
      )}

      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Previously connected
          </p>
          {past.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-[12px]"
            >
              <span className="font-medium">{connection.accountLogin}</span>
              <StatusChip tone="muted">{connectionHealth(connection).label}</StatusChip>
              <span className="text-muted-foreground">{timeAgo(connection.revokedAt)}</span>
              {canManage && config.ready && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={installing}
                  onClick={() => void install()}
                >
                  Reconnect
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
