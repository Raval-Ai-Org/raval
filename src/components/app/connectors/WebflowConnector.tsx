"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Globe, Loader2, RefreshCw, Trash } from "lucide-react";
import { toast } from "sonner";
import { SiteLogo } from "@/components/brand/SiteLogos";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ConnectionHealth, IntegrationDetails } from "./IntegrationDetails";
import {
  disconnectWebflow,
  getWebflowConnection,
  refreshWebflowSites,
  selectWebflowSite,
  startWebflowConnect,
} from "@/lib/webflow.functions";

type Connection = Awaited<ReturnType<typeof getWebflowConnection>>;

export function WebflowConnector({ workspaceId }: { workspaceId: string }) {
  const [connection, setConnection] = useState<Connection | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

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
    if (!connection || !window.confirm("Disconnect Webflow from this workspace?")) return;
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

  if (loading) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (error)
    return (
      <ErrorState
        size="sm"
        title="Webflow status unavailable"
        detail={error}
        onRetry={() => void load()}
      />
    );
  if (!connection)
    return (
      <article className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-sm transition-colors hover:border-primary/30">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#146EF5] text-sm font-black text-white shadow-sm">
            <SiteLogo provider="webflow" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold">Webflow</p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Not connected
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Analyze pages, CMS content and AI-search visibility.
            </p>
          </div>
          <Button size="sm" onClick={() => void connect()} disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}Connect Webflow
          </Button>
        </div>
        <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          Mellox requests read-only access and never publishes changes to Webflow.
        </p>
      </article>
    );

  return (
    <>
      <article className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-sm transition-colors hover:border-primary/30">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#146EF5] text-sm font-black text-white shadow-sm">
            <SiteLogo provider="webflow" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold">Webflow</p>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                <CheckCircle className="mr-1 inline size-3" /> Connected
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {connection.accountEmail}
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)}>
              Manage
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refresh()}
              disabled={busy}
              aria-label="Refresh Webflow sites"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void disconnect()}
              loading={busy}
              aria-label="Disconnect Webflow"
            >
              <Trash className="size-3.5 text-destructive" />
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Website source
            </p>
            <p className="mt-1 truncate text-[13px] font-semibold">
              {connection.selectedSite?.name ?? "No site selected"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {connection.selectedSite?.domain ?? "Choose a site for GEO"}
            </p>
          </div>
          <ConnectionHealth
            items={[
              {
                label: "OAuth",
                detail: connection.status === "active" ? "Valid" : "Needs attention",
                state: connection.status === "active" ? "healthy" : "error",
              },
              {
                label: "Site access",
                detail: connection.selectedSite ? "Available" : "Not selected",
                state: connection.selectedSite ? "healthy" : "warning",
              },
              { label: "API", detail: "Connected", state: "healthy" },
            ]}
          />
        </div>
      </article>
      <IntegrationDetails
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        icon={Globe}
        provider="Development & Website"
        title="Webflow connection"
        description="Choose the Webflow site Mellox uses for structured GEO and SEO context."
        status={
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
            <CheckCircle className="size-3.5" /> Connected
          </span>
        }
        health={[
          { label: "OAuth", detail: "Valid", state: "healthy" },
          {
            label: "Site access",
            detail: connection.selectedSite ? "Available" : "Choose a site",
            state: connection.selectedSite ? "healthy" : "warning",
          },
          { label: "API", detail: "Connected", state: "healthy" },
        ]}
        footer={
          <Button variant="ghost" onClick={() => void disconnect()} loading={busy}>
            Disconnect
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-card/50 px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Authorized account
            </p>
            <p className="mt-1 text-[13px] font-semibold">{connection.accountEmail}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Read-only access to sites, pages and CMS data.
            </p>
          </div>
          {connection.sites.length === 0 ? (
            <EmptyState
              size="sm"
              icon={Globe}
              title="No Webflow sites available"
              description="Check that this account can access at least one Webflow site."
            />
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold">Choose a site</p>
                <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
                </Button>
              </div>
              <ul className="space-y-2">
                {connection.sites.map((site) => (
                  <li
                    key={site.id}
                    className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{site.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {site.domain ?? `Site ID ${site.id}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={site.selected ? "secondary" : "outline"}
                      onClick={() => void select(site.id)}
                      disabled={site.selected}
                      loading={busy}
                    >
                      {site.selected ? (
                        <>
                          <CheckCircle className="size-3.5" /> Linked
                        </>
                      ) : (
                        "Connect site"
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </IntegrationDetails>
    </>
  );
}
