"use client";

// StudioDestinationPicker.tsx — publish destination selector. Pick a specific
// account, a platform, or all connected accounts. Platforms come from the
// active distribution provider; unconnected ones offer inline Connect. When a
// TikTok post is going out, the creator's allowed audiences are loaded and one
// must be chosen (TikTok forbids a default).
import { Spinner } from "@/components/icons";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useSdrStatus } from "@/hooks/use-sdr-status";
import {
  getConnections,
  getCreatorInfo,
  oauthStart,
  subscribeSocialConnect,
  type CreatorInfo,
} from "@/lib/sdr.functions";
import type { ConnectedAccount, PublishSelection } from "@/lib/sdr.handlers";
import { DISTRIBUTION_PLATFORMS } from "@/lib/distribution-platforms";

const TIKTOK_AUDIENCE: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export function StudioDestinationPicker({
  workspaceId,
  value,
  onChange,
  tiktok,
}: {
  workspaceId: string | null | undefined;
  value: PublishSelection;
  onChange: (sel: PublishSelection) => void;
  /** Present when a TikTok version is being sent. */
  tiktok?: { value: string | null; onChange: (level: string | null) => void };
}) {
  const status = useSdrStatus(workspaceId);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [pendingPlatform, setPendingPlatform] = useState<string | null>(null);
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    setLoading(true);
    try {
      setAccounts(await getConnections(workspaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connected accounts");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return subscribeSocialConnect(() => void refresh());
  }, [refresh]);

  const tiktokAccount = accounts.find((a) => a.platform === "tiktok" && a.status === "active");
  const wantsTiktok = Boolean(tiktok && tiktokAccount);
  const onTiktokChange = tiktok?.onChange;

  useEffect(() => {
    if (!wantsTiktok || !workspaceId || !tiktokAccount) return;
    let alive = true;
    setCreatorError(null);
    getCreatorInfo(workspaceId, tiktokAccount.accountId)
      .then((info) => {
        if (!alive) return;
        setCreator(info);
        // Drop a stale choice the creator no longer allows.
        if (tiktok?.value && !info.privacyLevels.includes(tiktok.value)) onTiktokChange?.(null);
      })
      .catch(
        (e) =>
          alive &&
          setCreatorError(e instanceof Error ? e.message : "Couldn't load TikTok settings"),
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsTiktok, workspaceId, tiktokAccount?.accountId]);

  const connect = async (platform: string) => {
    if (!workspaceId) return;
    const oauthWindow = window.open("about:blank", "_blank", "width=600,height=760");
    if (!oauthWindow) {
      setError(
        "Your browser blocked the social account window. Allow popups for this app and try again.",
      );
      return;
    }
    setConnecting(platform);
    try {
      const result = await oauthStart(workspaceId, platform);
      if (result.authorizationUrl) {
        oauthWindow.location.href = result.authorizationUrl;
        oauthWindow.focus();
      } else {
        oauthWindow.close();
        await refresh();
      }
    } catch (e) {
      oauthWindow.close();
      setError(e instanceof Error ? e.message : "Failed to start connect");
    } finally {
      setConnecting(null);
    }
  };

  const platforms = (status?.platforms ?? []).map((id) => DISTRIBUTION_PLATFORMS[id]);
  const active = accounts.filter((a) => a.status === "active");
  const pendingMeta = platforms.find((p) => p.id === pendingPlatform) ?? null;

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/50 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Publish to
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[10px] text-muted-foreground hover:text-foreground"
          aria-label="Refresh connections"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {pendingMeta && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="destination-connect-title"
            className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-2xl"
          >
            <h4 id="destination-connect-title" className="text-sm font-semibold text-foreground">
              Connect {pendingMeta.label}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              A window opens on {pendingMeta.label}&rsquo;s official authorization page so Mellox
              can post and schedule on your behalf.
            </p>
            {pendingMeta.connectNote ? (
              <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                {pendingMeta.connectNote}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingPlatform(null)}
                className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const platform = pendingMeta.id;
                  setPendingPlatform(null);
                  void connect(platform);
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Continue to {pendingMeta.label}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && accounts.length === 0 ? (
        <div className="space-y-1.5" aria-label="Loading destinations">
          <div className="h-6 animate-pulse rounded-md bg-secondary/60" />
          <div className="h-6 animate-pulse rounded-md bg-secondary/40" />
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="px-2 text-[11px] text-muted-foreground">Connect an account to publish.</p>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-muted/40">
              <input
                type="radio"
                name="sdr-dest"
                checked={value.type === "all"}
                onChange={() => onChange({ type: "all" })}
              />
              All connected accounts
            </label>
          )}
          {platforms.map((p) => {
            const platformAccounts = active.filter((a) => a.platform === p.id);
            const needsReconnect = accounts.some(
              (a) => a.platform === p.id && a.status === "expired",
            );
            return (
              <div key={p.id} className="space-y-0.5">
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-muted/40">
                  <input
                    type="radio"
                    name="sdr-dest"
                    checked={value.type === "platform" && value.platform === p.id}
                    onChange={() => onChange({ type: "platform", platform: p.id })}
                    disabled={platformAccounts.length === 0}
                  />
                  <span style={{ color: p.tint }} className="grid place-items-center">
                    <BrandLogo name={p.logo} brand size={14} />
                  </span>
                  {p.label}
                  {platformAccounts.length === 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setError(null);
                        setPendingPlatform(p.id);
                      }}
                      disabled={connecting === p.id || !status?.canPublish}
                      className="ml-auto rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      {connecting === p.id ? (
                        <Spinner className="h-3 w-3 animate-spin" aria-hidden />
                      ) : needsReconnect ? (
                        "Reconnect"
                      ) : (
                        "Connect"
                      )}
                    </button>
                  )}
                </label>
                {platformAccounts.map((a) => (
                  <label
                    key={a.accountId}
                    className="ml-6 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/30"
                  >
                    <input
                      type="radio"
                      name="sdr-dest"
                      checked={value.type === "account" && value.accountId === a.accountId}
                      onChange={() => onChange({ type: "account", accountId: a.accountId })}
                    />
                    <span className="truncate">
                      {a.displayName || a.platformUsername || a.accountId}
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </>
      )}

      {wantsTiktok && tiktok ? (
        <div className="mt-1 space-y-1 border-t border-border/60 px-2 pt-2">
          <label htmlFor="tiktok-audience" className="text-[11px] font-medium text-foreground">
            Who can watch the TikTok post?
          </label>
          {creatorError ? (
            <p className="text-[11px] text-destructive">{creatorError}</p>
          ) : !creator ? (
            <div className="h-8 animate-pulse rounded-md bg-secondary/60" />
          ) : !creator.canPost || creator.privacyLevels.length === 0 ? (
            <p className="text-[11px] text-warning">
              TikTok isn&apos;t accepting posts from this account right now (daily posting limit).
            </p>
          ) : (
            <select
              id="tiktok-audience"
              value={tiktok.value ?? ""}
              onChange={(e) => tiktok.onChange(e.target.value || null)}
              className="h-8 w-full rounded-md bg-surface-2 px-2 text-[12px] text-foreground ring-1 ring-border"
            >
              <option value="">Choose an audience…</option>
              {creator.privacyLevels.map((level) => (
                <option key={level} value={level}>
                  {TIKTOK_AUDIENCE[level] ?? level}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}
    </div>
  );
}
