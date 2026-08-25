// ConnectionsPanel.tsx — US1: the Connections view in the Studio rail.
// Shows the workspace's connected social accounts (status chip, disconnect /
// reconnect) + Connect buttons for platforms not yet connected. Refreshes on
// `connections:changed` / `content:changed` and on mount.
import { useCallback, useEffect, useState } from "react";
import { Linkedin, Twitter, Instagram, Facebook } from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";
import { getConnections, disconnectAccount, oauthStart } from "@/lib/sdr.functions";
import type { ConnectedAccount } from "@/lib/sdr.handlers";

const PLATFORMS = [
  { id: "twitter", label: "X", icon: Twitter, tint: "#0F1419" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, tint: "#0A66C2" },
  { id: "facebook", label: "Facebook", icon: Facebook, tint: "#1877F2" },
  { id: "instagram", label: "Instagram", icon: Instagram, tint: "#E1306C" },
] as const;

function currentWorkspaceId(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
}

export function ConnectionsPanel() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    window.addEventListener("connections:changed", onChange);
    window.addEventListener("content:changed", onChange);
    return () => {
      window.removeEventListener("connections:changed", onChange);
      window.removeEventListener("content:changed", onChange);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setBusy(null);
    }
  };

  const visible = accounts.filter((a) => a.status !== "disconnected");
  const connectedPlatforms = new Set(visible.map((a) => a.platform));

  return (
    <div className="space-y-2 px-2 py-1">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Connections
        </h3>
        <button
          onClick={() => void refresh()}
          className="text-[11px] text-muted-foreground hover:text-foreground"
          aria-label="Refresh connections"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !loading && visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">No brand accounts connected yet.</p>
      ) : null}

      {visible.map((a) => {
        const spec = PLATFORMS.find((p) => p.id === a.platform);
        const Icon = spec?.icon;
        const isActive = a.status === "active";
        return (
          <div
            key={a.accountId}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-2 py-1.5"
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: spec?.tint }} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{a.platformUsername || a.platform}</p>
              <p className="text-[10px] capitalize text-muted-foreground">{a.platform}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                isActive ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600",
              )}
            >
              {isActive ? "Connected" : "Expired"}
            </span>
            {isActive ? (
              <button
                onClick={() => void disconnect(a.accountId)}
                disabled={busy === a.accountId}
                className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => void connect(a.platform)}
                disabled={busy === a.platform}
                className="shrink-0 text-[10px] text-foreground hover:text-primary disabled:opacity-50"
              >
                Reconnect
              </button>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-1 pt-1">
        {PLATFORMS.filter((p) => !connectedPlatforms.has(p.id)).map((p) => (
          <button
            key={p.id}
            onClick={() => void connect(p.id)}
            disabled={busy === p.id}
            className="rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-50"
          >
            Connect {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
