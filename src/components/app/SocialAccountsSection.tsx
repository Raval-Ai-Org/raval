"use client";

// SocialAccountsSection — connect, reconnect and disconnect the workspace's
// social accounts. The platform list comes from the active distribution
// provider (GET /api/sdr/status), so only platforms that can actually publish
// are offered. Connections finish in a popup (/app/social/connected), which
// notifies this view over a BroadcastChannel.
import { Spinner } from "@/components/icons";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Plus, X } from "@/components/ui/gemini-icons";
import {
  disconnectAccount,
  getConnections,
  getSdrStatus,
  oauthStart,
  subscribeSocialConnect,
  type SdrStatus,
} from "@/lib/sdr.functions";
import type { ConnectedAccount } from "@/lib/sdr.handlers";
import {
  DISTRIBUTION_PLATFORMS,
  isDistributionPlatform,
  type DistributionPlatformMeta,
} from "@/lib/distribution-platforms";

function metaFor(platform: string): DistributionPlatformMeta | null {
  return isDistributionPlatform(platform) ? DISTRIBUTION_PLATFORMS[platform] : null;
}

const RECONNECT_COPY: Record<string, string> = {
  all_pages_removed: "Every connected Page was removed.",
  access_revoked: "Access was revoked on the platform.",
  youtube_account_suspended: "YouTube suspended this channel — resolve it with YouTube first.",
};

/** Platforms whose disconnect can't revoke the grant on the platform itself. */
const NO_REMOTE_REVOKE = new Set(["linkedin"]);

type Props = { variant: "studio" | "settings"; onManage?: () => void };

export function SocialAccountsSection({ variant }: Props) {
  // The workspace on screen: its own connections, never another brand's.
  const workspaceId = useOptionalWorkspaceId();
  const [status, setStatus] = useState<SdrStatus | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPlatform, setPendingPlatform] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ConnectedAccount | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const connectStartedAt = useRef(0);

  const refresh = useCallback(async () => {
    const id = workspaceId;
    if (!id) {
      setAccounts([]);
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await getSdrStatus(id);
      setStatus(nextStatus);
      setAccounts(nextStatus.enabled ? await getConnections(id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => void refresh();
    addAppEventListener("connections:changed", onChange);
    const unsubscribe = subscribeSocialConnect(() => {
      connectStartedAt.current = 0;
      void refresh();
      emitAppEvent("connections:changed");
    });
    // Fallback when BroadcastChannel is unavailable: re-check on return from
    // the popup, but only shortly after a connection was started.
    const onFocus = () => {
      if (connectStartedAt.current && Date.now() - connectStartedAt.current < 30 * 60_000) {
        void refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      removeAppEventListener("connections:changed", onChange);
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const connect = async (platform: string) => {
    if (!workspaceId) return;
    const oauthWindow = window.open("about:blank", "_blank", "width=600,height=760");
    if (!oauthWindow) {
      setError(
        "Your browser blocked the social account window. Allow popups for this app and try again.",
      );
      return;
    }
    setBusy(platform);
    setError(null);
    try {
      const result = await oauthStart(workspaceId, platform);
      if (result.authorizationUrl) {
        connectStartedAt.current = Date.now();
        oauthWindow.location.href = result.authorizationUrl;
        oauthWindow.focus();
      } else {
        oauthWindow.close();
        await refresh();
        emitAppEvent("connections:changed");
      }
    } catch (e) {
      oauthWindow.close();
      setError(e instanceof Error ? e.message : "Failed to start connect");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (account: ConnectedAccount) => {
    if (!workspaceId) return;
    setConfirmDisconnect(null);
    setBusy(account.accountId);
    setError(null);
    try {
      await disconnectAccount(workspaceId, account.accountId);
      await refresh();
      emitAppEvent("connections:changed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setBusy(null);
    }
  };

  const platforms = (status?.platforms ?? []).map((id) => DISTRIBUTION_PLATFORMS[id]);
  const visible = accounts.filter((account) => account.status !== "disconnected");
  const connectedPlatforms = new Set(visible.map((account) => account.platform));
  const addable = platforms.filter((platform) => !connectedPlatforms.has(platform.id));
  const pendingMeta = pendingPlatform ? metaFor(pendingPlatform) : null;
  const pendingLabel = pendingMeta?.label ?? pendingPlatform;
  const needsReconnect = visible.filter((a) => a.status !== "active").length;

  if (variant === "studio") {
    if (loading || error || !status?.enabled || !status.canPublish) return null;
    if (visible.length > 0 && needsReconnect === 0) return null;
  }

  return (
    <section
      className={cn(variant === "studio" ? "space-y-3 px-2 py-1" : "space-y-4")}
      aria-labelledby={`${variant}-connections-title`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            id={`${variant}-connections-title`}
            className={cn(
              "font-semibold text-foreground",
              variant === "studio"
                ? "text-xs uppercase tracking-wide"
                : "text-[20px] leading-tight tracking-tight",
            )}
          >
            {variant === "studio" ? "Connections" : "Social accounts"}
          </h3>
          {variant === "settings" && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Where Mellox posts for this workspace
            </p>
          )}
        </div>
        {variant === "settings" && (
          <button
            type="button"
            onClick={() => void refresh()}
            className="h-9 shrink-0 rounded-full border border-border/70 px-3.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Refresh connected accounts"
          >
            Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3" role="alert">
          <p className="text-[12px] font-medium text-destructive">Something went wrong.</p>
          <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 text-[11px] font-medium underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-label="Loading connected accounts">
          <div className="h-16 animate-pulse rounded-xl bg-secondary/70" />
          <div className="h-16 animate-pulse rounded-xl bg-secondary/50" />
        </div>
      ) : !status?.enabled ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-secondary/20 px-4 py-5 text-center">
          <p className="text-[13px] font-medium">Direct publishing isn&apos;t enabled</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Posts can still be copied or downloaded and published manually.
          </p>
        </div>
      ) : variant === "settings" ? (
        <div className="space-y-2">
          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-secondary/20 px-4 py-5 text-center">
              <p className="text-[13px] font-medium">No accounts connected</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Connect a channel below to publish and schedule from Studio.
              </p>
            </div>
          ) : (
            visible.map((account) => {
              const meta = metaFor(account.platform);
              const active = account.status === "active";
              const reason = account.reconnectReason
                ? (RECONNECT_COPY[account.reconnectReason] ?? account.reconnectReason)
                : null;
              return (
                <div
                  key={account.accountId}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-xl border border-border/70 bg-card/60 p-3"
                >
                  <div
                    className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary"
                    style={{ color: meta?.tint }}
                  >
                    {account.avatarUrl ? (
                      <img
                        src={account.avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : meta ? (
                      <BrandLogo name={meta.logo} brand size={18} />
                    ) : null}
                  </div>
                  <div className="min-w-0 self-center">
                    <p className="truncate text-[13px] font-medium">
                      {account.displayName || account.platformUsername || "Connected account"}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {meta?.label ?? account.platform}
                      {account.platformUsername && account.displayName !== account.platformUsername
                        ? ` · @${account.platformUsername}`
                        : ""}
                    </p>
                  </div>
                  <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                    <span
                      className={cn(
                        "whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold",
                        active
                          ? "bg-success-surface text-success"
                          : "bg-warning-surface text-warning",
                      )}
                      title={reason ?? undefined}
                    >
                      {active ? "Connected" : "Reconnect needed"}
                    </span>
                    <div className="flex items-center gap-1">
                      {!active && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPendingPlatform(account.platform)}
                          disabled={!status.canPublish}
                          loading={busy === account.platform}
                        >
                          Reconnect
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDisconnect(account)}
                        loading={busy === account.accountId}
                        disabled={!status.canPublish}
                      >
                        Disconnect
                      </Button>
                    </div>
                    {reason && !active ? (
                      <p className="w-full text-[11px] text-muted-foreground">{reason}</p>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          {status.canPublish && addable.length > 0 ? (
            <div className="border-t border-border/60 pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Add a channel
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {addable.map((platform) => (
                  <button
                    key={platform.id}
                    type="button"
                    onClick={() => setPendingPlatform(platform.id)}
                    disabled={busy === platform.id}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-card/45 p-2 text-left transition-colors hover:border-foreground/25 hover:bg-card disabled:opacity-60"
                  >
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary"
                      style={{ color: platform.tint }}
                    >
                      <BrandLogo name={platform.logo} brand size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {platform.label}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {platform.description}
                      </span>
                    </span>
                    {busy === platform.id ? (
                      <Spinner
                        className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!status.canPublish ? (
            <p className="text-[11px] text-muted-foreground">
              Only editors, admins and owners can change connected accounts.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {needsReconnect > 0 ? (
            <p className="rounded-lg bg-warning-surface px-2.5 py-2 text-[11.5px] text-warning">
              {needsReconnect === 1 ? "An account needs" : `${needsReconnect} accounts need`} to be
              reconnected before it can publish.
            </p>
          ) : null}
          {addable.length > 0 && (
            <div className="flex items-center justify-center rounded-lg border border-border/60 bg-card/45 px-2.5 py-2">
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-full justify-center gap-2.5"
                aria-label="Connect social media"
                title="Connect social media"
                onClick={() => setChooserOpen(true)}
              >
                {addable.slice(0, 5).map((platform) => (
                  <BrandLogo key={platform.id} name={platform.logo} brand size={16} />
                ))}
                <Plus className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      )}

      {chooserOpen && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setChooserOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="social-chooser-title"
            className="max-h-[calc(100dvh-2rem)] w-[min(100%,28rem)] overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 id="social-chooser-title" className="text-sm font-semibold">
                  Connect social media
                </h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose a channel to connect through its official authorization page.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChooserOpen(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Close social media chooser"
                title="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {addable.map((platform) => (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => {
                    setChooserOpen(false);
                    setPendingPlatform(platform.id);
                  }}
                  className="flex h-14 items-center gap-2 rounded-xl border border-border/70 bg-card/50 px-3 text-left transition-colors hover:border-foreground/25 hover:bg-card"
                >
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary"
                    style={{ color: platform.tint }}
                  >
                    <BrandLogo name={platform.logo} brand size={18} />
                  </span>
                  <span className="truncate text-[12px] font-medium">{platform.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {pendingPlatform && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="social-connect-title"
            className="max-h-[calc(100dvh-2rem)] w-[min(100%,24rem)] overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl"
          >
            <h4 id="social-connect-title" className="text-sm font-semibold">
              Connect {pendingLabel}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              A window opens on {pendingLabel}&rsquo;s official authorization page. You choose the
              permissions there, and can revoke access at any time.
            </p>
            {pendingMeta?.connectNote ? (
              <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {pendingMeta.connectNote}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingPlatform(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const platform = pendingPlatform;
                  setPendingPlatform(null);
                  void connect(platform);
                }}
              >
                Continue to {pendingLabel}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDisconnect && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="social-disconnect-title"
            className="w-[min(100%,24rem)] rounded-2xl border border-border bg-background p-5 shadow-2xl"
          >
            <h4 id="social-disconnect-title" className="text-sm font-semibold">
              Disconnect {confirmDisconnect.displayName || confirmDisconnect.platformUsername}?
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Scheduled posts to this account will fail until it&apos;s connected again. Published
              posts stay on the platform.
              {NO_REMOTE_REVOKE.has(confirmDisconnect.platform)
                ? " LinkedIn keeps the app listed in your LinkedIn settings; remove it there to fully revoke access."
                : ""}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDisconnect(null)}>
                Keep connected
              </Button>
              <Button variant="destructive" onClick={() => void disconnect(confirmDisconnect)}>
                Disconnect
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
