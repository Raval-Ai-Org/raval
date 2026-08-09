// StudioDestinationPicker.tsx — US2 publish destination selector. Lets the user
// pick a specific account, a platform, or all connected accounts (spec FR-005/
// FR-007/FR-028). Unconnected platforms offer inline Connect; undeliverable
// platforms (Threads/TikTok/YouTube) render "Not available" and are never offered.
import { useCallback, useEffect, useState } from "react";
import { Linkedin, Twitter, Instagram, Facebook } from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";
import { getConnections, oauthStart } from "@/lib/sdr.functions";
import type { ConnectedAccount, PublishSelection } from "@/lib/sdr.handlers";

const CONNECTABLE = [
  { id: "twitter", label: "X", icon: Twitter, tint: "#0F1419" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, tint: "#0A66C2" },
  { id: "facebook", label: "Facebook", icon: Facebook, tint: "#1877F2" },
  { id: "instagram", label: "Instagram", icon: Instagram, tint: "#E1306C" },
] as const;

const UNDELIVERABLE = [
  { id: "threads", label: "Threads" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
] as const;

export function StudioDestinationPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string | null | undefined;
  value: PublishSelection;
  onChange: (sel: PublishSelection) => void;
}) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      setAccounts(await getConnections(workspaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connected accounts");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async (platform: string) => {
    if (!workspaceId) return;
    setConnecting(platform);
    try {
      const { authorizationUrl } = await oauthStart(workspaceId, platform);
      window.open(authorizationUrl, "_blank", "noopener,noreferrer,width=600,height=700");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start connect");
    } finally {
      setConnecting(null);
    }
  };

  const connectedPlatforms = new Set(accounts.filter((a) => a.status !== "disconnected").map((a) => a.platform));

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/50 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Publish to</span>
        <button onClick={() => void refresh()} className="text-[10px] text-muted-foreground hover:text-foreground" aria-label="Refresh connections">
          Refresh
        </button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {accounts.filter((a) => a.status === "active").length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Connect a brand account to publish.</p>
      ) : (
        <>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-muted/40">
            <input type="radio" name="sdr-dest" checked={value.type === "all"} onChange={() => onChange({ type: "all" })} />
            All connected accounts
          </label>
          {CONNECTABLE.map((p) => {
            const platformAccounts = accounts.filter((a) => a.platform === p.id && a.status === "active");
            const Icon = p.icon;
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
                  <Icon className="h-3.5 w-3.5" style={{ color: p.tint }} />
                  {p.label}
                  {platformAccounts.length === 0 && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        void connect(p.id);
                      }}
                      disabled={connecting === p.id}
                      className="ml-auto rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {connecting === p.id ? "…" : "Connect"}
                    </button>
                  )}
                </label>
                {platformAccounts.map((a) => (
                  <label key={a.accountId} className="ml-6 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/30">
                    <input
                      type="radio"
                      name="sdr-dest"
                      checked={value.type === "account" && value.accountId === a.accountId}
                      onChange={() => onChange({ type: "account", accountId: a.accountId })}
                    />
                    <span className="truncate">{a.platformUsername || a.accountId}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </>
      )}

      <div className="flex flex-wrap gap-1 pt-1">
        {UNDELIVERABLE.map((p) => (
          <span key={p.id} className={cn("rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground/60")}>
            {p.label} · not available
          </span>
        ))}
      </div>
    </div>
  );
}
