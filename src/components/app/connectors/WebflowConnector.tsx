"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Globe, Mail, RefreshCw } from "@/components/icons";
import { SiteLogo } from "@/components/brand/SiteLogos";
import { SiteIcon } from "@/components/app/surface/SiteIcon";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  ConnectionCard,
  ConnectionFact,
  ConnectionSkeleton,
  ConnectionStatus,
} from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import { IntegrationDetails } from "./IntegrationDetails";
import {
  disconnectWebflow,
  getWebflowConnection,
  refreshWebflowSites,
  selectWebflowSite,
  startWebflowConnect,
} from "@/lib/webflow.functions";

export type WebflowConnection = Awaited<ReturnType<typeof getWebflowConnection>>;

const WebflowIcon = ({ className }: { className?: string }) => (
  <SiteLogo provider="webflow" size={16} className={className} />
);

/** The Webflow card and its details window. Presentational: it only calls back. */
export function WebflowView({
  connection,
  busy,
  onConnect,
  onRefresh,
  onSelect,
  onDisconnect,
}: {
  connection: WebflowConnection;
  busy: boolean;
  onConnect: () => void;
  onRefresh: () => void;
  onSelect: (siteId: string) => void;
  onDisconnect: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const logo = <SiteLogo provider="webflow" size={22} brand />;

  if (!connection)
    return (
      <ConnectionCard
        label="Webflow connection"
        logo={logo}
        name="Webflow"
        description="Your Webflow pages and CMS"
        status={{ tone: "off", text: "Not connected" }}
        actions={
          <Button size="sm" variant="outline" onClick={onConnect} loading={busy}>
            Connect
          </Button>
        }
      />
    );

  const active = connection.status === "active";
  const site = connection.selectedSite;
  return (
    <>
      <ConnectionCard
        label="Webflow connection"
        logo={logo}
        name="Webflow"
        description={site ? (site.domain ?? site.name) : "Choose the site Mellox works on"}
        status={
          !active
            ? { tone: "attention", text: "Needs attention" }
            : site
              ? { tone: "connected", text: "Connected" }
              : { tone: "attention", text: "Choose a site" }
        }
        facts={
          <>
            {connection.accountEmail && (
              <ConnectionFact icon={Mail}>{connection.accountEmail}</ConnectionFact>
            )}
            {site && <ConnectionFact icon={Globe}>{site.name}</ConnectionFact>}
          </>
        }
        actions={
          <Button
            size="sm"
            variant={site ? "outline" : "default"}
            onClick={() => setDetailsOpen(true)}
          >
            {site ? "Manage" : "Choose site"}
          </Button>
        }
      />
      <IntegrationDetails
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        icon={WebflowIcon}
        logo={logo}
        provider="Webflow"
        title="Webflow"
        account={connection.accountEmail ?? "Webflow account"}
        status={
          <ConnectionStatus
            tone={active ? "connected" : "attention"}
            text={active ? "Connected" : "Needs attention"}
          />
        }
        health={[
          {
            label: "Sign-in",
            detail: active ? "Working" : "Connect again",
            state: active ? "healthy" : "error",
          },
          {
            label: "Site",
            detail: site ? "Chosen" : "Not chosen",
            state: site ? "healthy" : "warning",
          },
          {
            label: "Sites found",
            detail: String(connection.sites.length),
            state: connection.sites.length ? "healthy" : "warning",
          },
        ]}
        footer={
          <Button variant="ghost" onClick={() => setConfirmOpen(true)} disabled={busy}>
            Disconnect
          </Button>
        }
      >
        {connection.sites.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Globe}
            title="No sites found"
            description="This Webflow account has no sites Mellox can see."
            action={
              <Button size="sm" variant="outline" onClick={onRefresh} loading={busy}>
                Check again
              </Button>
            }
          />
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="ds-label">Your sites</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={onRefresh}
                disabled={busy}
                aria-label="Refresh Webflow sites"
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
              </Button>
            </div>
            <SiteList
              sites={connection.sites.map((s) => ({
                id: s.id,
                name: s.name,
                domain: s.domain ?? null,
                selected: s.selected,
              }))}
              busy={busy}
              onSelect={onSelect}
            />
          </div>
        )}
      </IntegrationDetails>
      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        name="Webflow"
        busy={busy}
        onConfirm={() => {
          setConfirmOpen(false);
          setDetailsOpen(false);
          onDisconnect();
        }}
      />
    </>
  );
}

/** A list of sites to pick one from, shared by Webflow and WordPress. */
export function SiteList({
  sites,
  busy,
  onSelect,
}: {
  sites: { id: string; name: string; domain: string | null; selected: boolean }[];
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-2" role="radiogroup" aria-label="Sites">
      {sites.map((site) => (
        <li key={site.id}>
          <button
            type="button"
            role="radio"
            aria-checked={site.selected}
            disabled={busy || site.selected}
            onClick={() => onSelect(site.id)}
            className={cn(
              "ds-tile flex w-full items-center gap-3 p-3 text-left transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              site.selected
                ? "border-primary/50 bg-primary/[0.06]"
                : "ds-tile-hover disabled:opacity-60",
            )}
          >
            {site.domain ? (
              <SiteIcon domain={site.domain.replace(/^https?:\/\//, "")} size={32} />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-[30%] bg-[var(--ds-well-bg)] text-muted-foreground">
                <Globe className="size-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {site.name}
              </span>
              {site.domain && (
                <span className="block truncate text-[12px] text-muted-foreground">
                  {site.domain.replace(/^https?:\/\//, "")}
                </span>
              )}
            </span>
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                site.selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border",
              )}
              aria-hidden
            >
              {site.selected && <Check className="size-3" />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function WebflowConnector({ workspaceId }: { workspaceId: string }) {
  const [connection, setConnection] = useState<WebflowConnection | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConnection(await getWebflowConnection({ data: { workspaceId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Webflow status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    try {
      const result = await startWebflowConnect({
        data: {
          workspaceId,
          returnOrigin: window.location.origin,
          returnPath: `${window.location.pathname}${window.location.search}`,
        },
      });
      window.location.assign(result.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webflow could not be connected.");
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      setConnection(await refreshWebflowSites({ data: { workspaceId } }));
      toast.success("Webflow sites refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webflow sites could not be refreshed.");
    } finally {
      setBusy(false);
    }
  };
  const select = async (siteId: string) => {
    if (!connection) return;
    setBusy(true);
    try {
      setConnection(
        await selectWebflowSite({
          data: { workspaceId, connectionId: connection.connectionId, siteId },
        }),
      );
      toast.success("Webflow site linked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That Webflow site could not be linked.");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await disconnectWebflow({ data: { workspaceId, connectionId: connection.connectionId } });
      setConnection(null);
      toast.success("Webflow disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webflow could not be disconnected.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ConnectionSkeleton label="Loading Webflow" />;
  if (error || connection === undefined)
    return (
      <ErrorState
        size="sm"
        title="Webflow didn't load"
        detail={error ?? undefined}
        onRetry={() => void load()}
      />
    );
  return (
    <WebflowView
      connection={connection}
      busy={busy}
      onConnect={() => void connect()}
      onRefresh={() => void refresh()}
      onSelect={(id) => void select(id)}
      onDisconnect={() => void disconnect()}
    />
  );
}
