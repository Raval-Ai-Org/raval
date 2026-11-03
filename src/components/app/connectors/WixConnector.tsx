"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { Globe, Mail, RefreshCw } from "@/components/icons";
import { SiteLogo } from "@/components/brand/SiteLogos";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  ConnectionCard,
  ConnectionFact,
  ConnectionSkeleton,
  ConnectionStatus,
} from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import { IntegrationDetails } from "./IntegrationDetails";
import { useConnectWindow } from "./useConnectWindow";
import {
  disconnectWix,
  getWixAvailability,
  getWixConnection,
  refreshWixSite,
  startWixConnect,
} from "@/lib/wix.functions";

export type WixConnection = Awaited<ReturnType<typeof getWixConnection>>;

const WixIcon = ({ className }: { className?: string }) => (
  <SiteLogo provider="wix" size={16} className={className} />
);

/** The Wix card and its details window. Presentational: it only calls back. */
export function WixView({
  connection,
  busy,
  onConnect,
  onRefresh,
  onDisconnect,
}: {
  connection: WixConnection;
  busy: boolean;
  onConnect: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const logo = <SiteLogo provider="wix" size={22} brand />;

  if (!connection)
    return (
      <ConnectionCard
        label="Wix connection"
        logo={logo}
        name="Wix"
        description="Your Wix site and blog"
        status={{ tone: "off", text: "Not connected" }}
        actions={
          <Button size="sm" variant="outline" onClick={onConnect} loading={busy}>
            Connect
          </Button>
        }
      />
    );

  const active = connection.status === "active";
  const site = connection.site;
  const address = site?.url?.replace(/^https?:\/\//, "") ?? null;
  return (
    <>
      <ConnectionCard
        label="Wix connection"
        logo={logo}
        name="Wix"
        description={site ? (address ?? site.name) : "Connect Wix again to see your site"}
        status={
          active
            ? { tone: "connected", text: "Connected" }
            : { tone: "attention", text: "Needs attention" }
        }
        facts={
          <>
            {connection.accountLabel.includes("@") && (
              <ConnectionFact icon={Mail}>{connection.accountLabel}</ConnectionFact>
            )}
            {site && <ConnectionFact icon={Globe}>{site.name}</ConnectionFact>}
          </>
        }
        actions={
          active ? (
            <Button size="sm" variant="outline" onClick={() => setDetailsOpen(true)}>
              Manage
            </Button>
          ) : (
            <Button size="sm" onClick={onConnect} loading={busy}>
              Connect again
            </Button>
          )
        }
      />
      <IntegrationDetails
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        icon={WixIcon}
        logo={logo}
        provider="Wix"
        title="Wix"
        account={site?.name ?? "Wix site"}
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
            label: "Site address",
            detail: address ?? "Not published yet",
            state: address ? "healthy" : "warning",
          },
          {
            label: "Blog",
            detail: site?.hasBlog ? "Wix Blog found" : "No blog yet",
            state: site?.hasBlog ? "healthy" : "warning",
          },
        ]}
        footer={
          <Button variant="ghost" onClick={() => setConfirmOpen(true)} disabled={busy}>
            Disconnect
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="ds-label">Your site</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={busy}
              aria-label="Check your Wix site again"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Check again
            </Button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {site?.hasBlog
              ? "Mellox can post articles to your blog and fix page titles and descriptions."
              : "Mellox can fix page titles and descriptions. To post articles, add Wix Blog in the Wix editor."}
          </p>
          <p className="text-[12px] text-muted-foreground">
            Disconnecting stops Mellox using your site. To remove the app from Wix too, open your
            Wix dashboard → Apps → Manage apps.
          </p>
          {!active && (
            <Button size="sm" onClick={onConnect} loading={busy}>
              Connect again
            </Button>
          )}
        </div>
      </IntegrationDetails>
      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        name="Wix"
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

export function WixConnector({ workspaceId }: { workspaceId: string }) {
  const [connection, setConnection] = useState<WixConnection | undefined>();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [setup, view] = await Promise.all([
        getWixAvailability({ data: { workspaceId } }),
        getWixConnection({ data: { workspaceId } }),
      ]);
      setAvailable(setup.available);
      setConnection(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wix status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Wix's installer runs in its own window; this hears when it closes.
  const wixWindow = useConnectWindow("wix", workspaceId, (result) => {
    if (result?.status === "connected") toast.success("Wix connected");
    void load();
  });
  const connect = async () => {
    setBusy(true);
    try {
      await wixWindow.connect(
        async () =>
          (
            await startWixConnect({
              data: {
                workspaceId,
                returnOrigin: window.location.origin,
                returnPath: `${window.location.pathname}${window.location.search}`,
              },
            })
          ).url,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Wix could not be connected.");
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      setConnection(await refreshWixSite({ data: { workspaceId } }));
      toast.success("Wix site checked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Wix could not be checked.");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await disconnectWix({ data: { workspaceId, connectionId: connection.connectionId } });
      setConnection(null);
      toast.success("Wix disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Wix could not be disconnected.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ConnectionSkeleton label="Loading Wix" />;
  // Without Mellox's Wix app keys nobody can connect, so the tile isn't shown
  // at all; a site that is already connected still shows so it can be removed.
  if (!error && !available && !connection) return null;
  if (error || connection === undefined)
    return (
      <ErrorState
        size="sm"
        title="Wix didn't load"
        detail={error ?? undefined}
        onRetry={() => void load()}
      />
    );
  return (
    <WixView
      connection={connection}
      busy={busy}
      onConnect={() => void connect()}
      onRefresh={() => void refresh()}
      onDisconnect={() => void disconnect()}
    />
  );
}
