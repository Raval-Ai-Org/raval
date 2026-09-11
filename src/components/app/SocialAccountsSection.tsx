"use client";

import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Plus, X } from "@/components/ui/gemini-icons";
import { disconnectAccount, getConnections, oauthStart } from "@/lib/sdr.functions";
import type { ConnectedAccount } from "@/lib/sdr.handlers";

export const SOCIAL_PLATFORMS = [
  {
    id: "twitter",
    label: "X",
    logo: "x",
    description: "Short-form updates and launches",
    tint: "#0F1419",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    logo: "linkedin",
    description: "Professional updates and thought leadership",
    tint: "#0A66C2",
  },
  {
    id: "facebook",
    label: "Facebook",
    logo: "facebook",
    description: "Pages, communities, and announcements",
    tint: "#1877F2",
  },
  {
    id: "instagram",
    label: "Instagram",
    logo: "instagram",
    description: "Visual stories and feed content",
    tint: "#E1306C",
  },
] as const;

function currentWorkspaceId(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
}

type Props = { variant: "studio" | "settings"; onManage?: () => void };

export function SocialAccountsSection({ variant, onManage }: Props) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPlatform, setPendingPlatform] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  const refresh = useCallback(async () => {
    const id = currentWorkspaceId();
    setWorkspaceId(id);
    if (!id) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setAccounts(await getConnections(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => void refresh();
    addAppEventListener("connections:changed", onChange);
    addAppEventListener("content:changed", onChange);
    return () => {
      removeAppEventListener("connections:changed", onChange);
      removeAppEventListener("content:changed", onChange);
    };
  }, [refresh]);

  const connect = async (platform: string) => {
    if (!workspaceId) return;
    const oauthWindow = window.open("about:blank", "_blank", "width=600,height=700");
    if (!oauthWindow) {
      setError(
        "Your browser blocked the social account window. Allow popups for this app and try again.",
      );
      return;
    }
    setBusy(platform);
    setError(null);
    try {
      const { authorizationUrl } = await oauthStart(workspaceId, platform);
      oauthWindow.location.href = authorizationUrl;
      oauthWindow.focus();
    } catch (e) {
      oauthWindow.close();
      setError(e instanceof Error ? e.message : "Failed to start connect");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (accountId: string) => {
    if (!workspaceId) return;
    setBusy(accountId);
    setError(null);
    try {
      await disconnectAccount(workspaceId, accountId);
      await refresh();
      emitAppEvent("connections:changed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setBusy(null);
    }
  };

  const visible = accounts.filter((account) => account.status !== "disconnected");
  const connectedPlatforms = new Set(visible.map((account) => account.platform));
  const pendingLabel =
    SOCIAL_PLATFORMS.find((platform) => platform.id === pendingPlatform)?.label ?? pendingPlatform;

  if (variant === "studio" && !loading && !error && visible.length > 0) {
    return null;
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
              variant === "studio" ? "text-xs uppercase tracking-wide" : "text-sm",
            )}
          >
            {variant === "studio" ? "Connections" : "Connected accounts"}
          </h3>
          {variant === "settings" && (
            <p className="mt-1 max-w-xl break-words text-[12px] leading-relaxed text-muted-foreground">
              Manage the social identities available to your workspace.
            </p>
          )}
        </div>
        {variant === "settings" && (
          <button
            type="button"
            onClick={() => void refresh()}
            className="shrink-0 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            aria-label="Refresh connected accounts"
          >
            Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
          <p className="text-[12px] font-medium text-destructive">
            We couldn't load your accounts.
          </p>
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
              const platform = SOCIAL_PLATFORMS.find((item) => item.id === account.platform);
              const active = account.status === "active";
              return (
                <div
                  key={account.accountId}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-xl border border-border/70 bg-card/60 p-3"
                >
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary"
                    style={{ color: platform?.tint }}
                  >
                    {platform && <BrandLogo name={platform.logo} brand size={18} />}
                  </div>
                  <div className="min-w-0 self-center">
                    <p className="truncate text-[13px] font-medium">
                      {account.platformUsername || "Connected account"}
                    </p>
                    <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
                      {platform?.label ?? account.platform}
                    </p>
                  </div>
                  <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                    <span
                      className={cn(
                        "whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold",
                        active
                          ? "bg-emerald-500/12 text-emerald-600"
                          : "bg-amber-500/15 text-amber-700",
                      )}
                    >
                      {active ? "Connected" : "Reconnect needed"}
                    </span>
                    {active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void disconnect(account.accountId)}
                        disabled={busy === account.accountId}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingPlatform(account.platform)}
                        disabled={busy === account.platform}
                      >
                        Reconnect
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div className="border-t border-border/60 pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Add another channel
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {SOCIAL_PLATFORMS.filter((platform) => !connectedPlatforms.has(platform.id)).map(
                (platform) => {
                  return (
                    <div
                      key={platform.id}
                      className="flex min-w-0 items-center justify-center gap-3 rounded-xl border border-border/70 bg-card/45 p-2"
                    >
                      <div
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary"
                        style={{ color: platform.tint }}
                      >
                        <BrandLogo name={platform.logo} brand size={18} />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 shrink-0 p-0"
                        aria-label={`Connect ${platform.label}`}
                        title={`Connect ${platform.label}`}
                        onClick={() => setPendingPlatform(platform.id)}
                        disabled={busy === platform.id}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-border/60 bg-card/45 px-2.5 py-2">
          {visible.length < SOCIAL_PLATFORMS.length && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full justify-center gap-3"
              aria-label="Connect social media"
              title="Connect social media"
              onClick={() => setChooserOpen(true)}
            >
              {SOCIAL_PLATFORMS.map((platform) => (
                <BrandLogo key={platform.id} name={platform.logo} brand size={18} />
              ))}
              <Plus className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}

      {chooserOpen && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="social-chooser-title"
            className="max-h-[calc(100dvh-2rem)] w-[min(100%,28rem)] overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-2xl"
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
            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {SOCIAL_PLATFORMS.filter((platform) => !connectedPlatforms.has(platform.id)).map(
                (platform) => {
                  return (
                    <button
                      key={platform.id}
                      type="button"
                      aria-label={`Connect ${platform.label}`}
                      title={`Connect ${platform.label}`}
                      onClick={() => {
                        setChooserOpen(false);
                        setPendingPlatform(platform.id);
                      }}
                      className="flex h-14 items-center justify-center rounded-xl border border-border/70 bg-card/50 p-2 text-left transition-colors hover:border-foreground/25 hover:bg-card"
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary"
                        style={{ color: platform.tint }}
                      >
                        <BrandLogo name={platform.logo} brand size={18} />
                      </span>
                      <span className="sr-only">{platform.label}</span>
                    </button>
                  );
                },
              )}
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
              RavalAI will redirect you to {pendingLabel}'s official authorization page. You choose
              the permissions there, and can revoke access at any time.
            </p>
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
    </section>
  );
}
