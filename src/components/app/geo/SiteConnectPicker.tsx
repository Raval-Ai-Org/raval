"use client";

// SiteConnectPicker — the three ways Mellox can change a website (GitHub,
// WordPress, Webflow) as simple icon tiles. The one that serves the site is
// marked; the rest connect in one click and bring the person back to where
// they were. All states come from getSiteConnections.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { SiteLogo, SITE_PLATFORM_LABEL } from "@/components/brand/SiteLogos";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { emitAppEvent } from "@/lib/app-events";
import { getSiteConnections } from "@/lib/geo-fixes.functions";
import type { SiteConnections, SiteConnectionTile, SiteProviderId } from "@/lib/geo/fix-contracts";
import { cn } from "@/lib/utils";
import { startWebflowConnect } from "@/lib/webflow.functions";
import { startWordPressOAuth } from "@/lib/wordpress.functions";
import { useGithubInstall } from "../connectors/useGithubInstall";

const STATUS: Record<SiteConnectionTile["state"], string> = {
  serves_site: "Connected",
  needs_check: "Check needed",
  connected_other: "Connected",
  not_connected: "Connect",
  unavailable: "Unavailable",
};

export function SiteConnectPicker({
  workspaceId,
  connections,
  selected,
  onSelect,
  returnPath = "/app?geo=findings&fix=all",
}: {
  workspaceId: string;
  connections: SiteConnections;
  selected: SiteProviderId;
  onSelect: (p: SiteProviderId) => void;
  /** Workspace-relative path the connect flows return to. */
  returnPath?: string;
}) {
  const { installing, install } = useGithubInstall(workspaceId, returnPath);
  const [busy, setBusy] = useState<SiteProviderId | null>(null);
  const tile = connections.tiles.find((t) => t.provider === selected) ?? connections.tiles[0];
  const back = `/w/${workspaceId}${returnPath}`;

  const connect = async (p: SiteProviderId) => {
    if (p === "github") return install();
    setBusy(p);
    try {
      const start = p === "wordpress" ? startWordPressOAuth : startWebflowConnect;
      const { url } = await start({
        data: { workspaceId, returnOrigin: window.location.origin, returnPath: back },
      });
      window.location.assign(url);
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof Error ? e.message : `Couldn't open ${SITE_PLATFORM_LABEL[p]}`);
    }
  };
  const openSettings = () => emitAppEvent("open:settings", { section: "website" });

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Website platform" className="grid grid-cols-3 gap-2">
        {connections.tiles.map((t) => {
          const active = t.provider === selected;
          const on = t.state === "serves_site";
          return (
            <button
              key={t.provider}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(t.provider)}
              className={cn(
                "relative flex flex-col items-center gap-1.5 rounded-2xl border bg-card px-2 pb-2.5 pt-3.5 transition-[border-color,box-shadow] duration-150",
                active
                  ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary))]"
                  : "border-border/70 hover:border-border",
              )}
            >
              {on ? (
                <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              ) : null}
              <SiteLogo provider={t.provider} size={28} brand />
              <span className="text-[12.5px] font-medium">{SITE_PLATFORM_LABEL[t.provider]}</span>
              <span
                className={cn(
                  "text-[11px]",
                  on
                    ? "text-primary"
                    : t.state === "needs_check"
                      ? "text-warning"
                      : "text-muted-foreground",
                )}
              >
                {t.detected && !on ? "Your platform" : STATUS[t.state]}
              </span>
            </button>
          );
        })}
      </div>

      {tile ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
            {tile.detail}
          </p>
          {tile.state === "not_connected" ? (
            connections.canManage ? (
              <Button
                size="sm"
                loading={tile.provider === "github" ? installing : busy === tile.provider}
                onClick={() => void connect(tile.provider)}
              >
                Connect {SITE_PLATFORM_LABEL[tile.provider]}
              </Button>
            ) : (
              <span className="text-[12px] text-muted-foreground">Ask an admin to connect it</span>
            )
          ) : tile.state === "connected_other" && tile.provider !== "github" ? (
            <Button size="sm" variant="outline" onClick={openSettings}>
              Choose site
            </Button>
          ) : null}
        </div>
      ) : null}
      {tile?.provider === "wordpress" && tile.state === "not_connected" && connections.canManage ? (
        <button
          type="button"
          onClick={openSettings}
          className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Self-hosted WordPress? Connect with an app password
        </button>
      ) : null}
    </div>
  );
}

/** The picker with its own data, for places that only need "connect your site". */
export function SiteConnectSection({
  workspaceId,
  scanId,
  returnPath,
}: {
  workspaceId: string;
  scanId: string;
  returnPath?: string;
}) {
  const [connections, setConnections] = useState<SiteConnections | null>(null);
  const [selected, setSelected] = useState<SiteProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSiteConnections({ data: { workspaceId, scanId } })
      .then((c) => {
        if (cancelled) return;
        setConnections(c);
        setSelected((cur) => cur ?? c.active ?? c.detected ?? c.tiles[0]?.provider ?? "github");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load"));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scanId]);
  if (error) return <p className="text-[12px] text-destructive">{error}</p>;
  if (!connections || !selected) return <Skeleton className="h-28 w-full rounded-xl" />;
  return (
    <SiteConnectPicker
      workspaceId={workspaceId}
      connections={connections}
      selected={selected}
      onSelect={setSelected}
      returnPath={returnPath}
    />
  );
}
