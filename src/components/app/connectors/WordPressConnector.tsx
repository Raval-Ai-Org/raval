"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle,
  Globe as WordPress,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  disconnectWordPress,
  connectWordPress,
  getWordPressConnection,
  refreshWordPress,
  selectWordPressSite,
  startWordPressOAuth,
} from "@/lib/wordpress.functions";
import { ConnectionHealth, IntegrationDetails } from "./IntegrationDetails";

type Connection = Awaited<ReturnType<typeof getWordPressConnection>>;

export function WordPressConnector({ workspaceId }: { workspaceId: string }) {
  const [connection, setConnection] = useState<Connection | null | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showSelfHosted, setShowSelfHosted] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [applicationPassword, setApplicationPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConnection(await getWordPressConnection({ data: { workspaceId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "WordPress status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setConnection(
        await connectWordPress({ data: { workspaceId, siteUrl, username, applicationPassword } }),
      );
      setApplicationPassword("");
      setShowSelfHosted(false);
      setDetailsOpen(true);
      toast.success("WordPress connected and verified");
    } catch (e) {
      const message = e instanceof Error ? e.message : "WordPress could not be verified.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const connectOAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startWordPressOAuth({
        data: {
          workspaceId,
          returnOrigin: window.location.origin,
          returnPath: `${window.location.pathname}${window.location.search}`,
        },
      });
      window.location.assign(result.url);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "WordPress.com could not be reached. Please try again.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      setConnection(await refreshWordPress({ data: { workspaceId } }));
      toast.success("WordPress connection refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "WordPress could not be refreshed.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!connection || !window.confirm("Disconnect WordPress from this workspace?")) return;
    setBusy(true);
    try {
      await disconnectWordPress({ data: { workspaceId, connectionId: connection.connectionId } });
      setConnection(null);
      setDetailsOpen(false);
      toast.success("WordPress disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "WordPress could not be disconnected.");
    } finally {
      setBusy(false);
    }
  };

  const selectSite = async (siteId: string) => {
    if (!connection) return;
    setBusy(true);
    try {
      setConnection(
        await selectWordPressSite({
          data: { workspaceId, connectionId: connection.connectionId, siteId },
        }),
      );
      toast.success("WordPress.com site selected");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "That WordPress.com site could not be selected.",
      );
    } finally {
      setBusy(false);
    }
  };

  const siteDisplay = connection?.selectedSite ?? connection?.sites?.[0] ?? null;
  const selectedSiteUrl = siteDisplay?.url || connection?.siteUrl || "";

  if (loading) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (error)
    return (
      <ErrorState
        size="sm"
        title="WordPress status unavailable"
        detail={error}
        onRetry={() => void load()}
      />
    );

  if (!connection) {
    return (
      <article className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#21759b] text-sm font-black text-white">
            <WordPress className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold">WordPress</p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                Not connected
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Connect your WordPress sites to Mellox.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-border/70 bg-background/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">WordPress.com</p>
                <p className="text-[11px] text-muted-foreground">Recommended</p>
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Recommended
              </span>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Connect securely with WordPress.com
            </p>
            <Button className="mt-3 w-full" onClick={() => void connectOAuth()} disabled={busy}>
              {busy && <Loader2 className="mr-2 size-3.5 animate-spin" />}Connect WordPress.com
            </Button>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Self-hosted WordPress</p>
                <p className="text-[11px] text-muted-foreground">
                  Connect with Application Password
                </p>
              </div>
              <ShieldCheck className="size-4 text-muted-foreground" />
            </div>
            {!showSelfHosted ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowSelfHosted(true)}
                loading={busy}
              >
                Connect self-hosted WordPress
              </Button>
            ) : (
              <form onSubmit={connect} className="space-y-3 pt-2">
                <Input
                  required
                  type="url"
                  placeholder="https://your-site.com"
                  aria-label="WordPress site URL"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                />
                <Input
                  required
                  placeholder="Username"
                  aria-label="WordPress username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <Input
                  required
                  type="password"
                  placeholder="Application Password"
                  aria-label="WordPress application password"
                  value={applicationPassword}
                  onChange={(e) => setApplicationPassword(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setShowSelfHosted(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1" disabled={busy}>
                    {busy && <Loader2 className="mr-2 size-3.5 animate-spin" />}Connect self-hosted
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>

        <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          Mellox never needs your normal WordPress password. For self-hosted sites, we use a
          dedicated Application Password.
        </p>
      </article>
    );
  }

  return (
    <>
      <article className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#21759b] text-sm font-black text-white">
            <WordPress className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold">WordPress</p>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  connection.status === "active"
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                {connection.status === "active" && <CheckCircle className="mr-1 inline size-3" />}
                {connection.status === "active" ? "Connected" : "Needs attention"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {selectedSiteUrl || connection.siteUrl || "Choose a WordPress site"}
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
              aria-label="Refresh WordPress connection"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void disconnect()}
              loading={busy}
              aria-label="Disconnect WordPress"
            >
              <Trash className="size-3.5 text-destructive" />
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Site
            </p>
            <p className="mt-1 text-[13px] font-semibold">
              {siteDisplay?.name || connection.siteName || "Choose a site"}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {siteDisplay?.url || connection.siteUrl || "No site selected yet"}
            </p>
          </div>
          <ConnectionHealth
            items={[
              {
                label: "REST API",
                detail: connection.status === "active" ? "Available" : "Needs attention",
                state: connection.status === "active" ? "healthy" : "error",
              },
              {
                label: "Account",
                detail: connection.accountName || connection.username || "Connected",
                state: "healthy",
              },
              { label: "GEO source", detail: "Available", state: "healthy" },
            ]}
          />
        </div>
      </article>

      <IntegrationDetails
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        icon={WordPress}
        provider="Development & Website"
        title="WordPress connection"
        description="Choose the WordPress site Mellox should use for content management and GEO context."
        status={
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
            <CheckCircle className="size-3.5" /> Connected
          </span>
        }
        health={[
          { label: "REST API", detail: "Verified", state: "healthy" },
          { label: "Account", detail: connection.accountName || "Connected", state: "healthy" },
          {
            label: "GEO source",
            detail: siteDisplay ? "Selected" : "Choose a site",
            state: siteDisplay ? "healthy" : "warning",
          },
        ]}
        footer={
          <>
            <Button variant="outline" onClick={() => void refresh()} loading={busy}>
              Refresh
            </Button>
            <Button variant="ghost" onClick={() => void disconnect()} loading={busy}>
              Disconnect
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-card/50 px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Account
            </p>
            <p className="mt-1 text-[13px] font-semibold">{connection.accountName}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {connection.authType === "wordpress_com_oauth"
                ? "Connected WordPress.com account"
                : "Connected WordPress account"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Last verified:{" "}
              {connection.lastVerifiedAt
                ? new Date(connection.lastVerifiedAt).toLocaleString()
                : "Not yet"}
            </p>
          </div>

          {connection.authType === "wordpress_com_oauth" && (
            <div className="rounded-xl border border-border/70 bg-card/50 px-3.5 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold">Choose a WordPress.com site</p>
                <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                  Refresh
                </Button>
              </div>
              {connection.sites.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No WordPress.com sites were returned for this account.
                </p>
              ) : (
                <ul className="space-y-2">
                  {connection.sites.map((site) => (
                    <li
                      key={site.id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{site.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{site.url}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          {site.status}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={site.selected ? "secondary" : "outline"}
                        onClick={() => void selectSite(site.siteId ?? site.id)}
                        disabled={site.selected}
                        loading={busy}
                      >
                        {site.selected ? "Selected" : "Select site"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </IntegrationDetails>
    </>
  );
}
