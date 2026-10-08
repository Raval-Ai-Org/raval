"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "@/lib/toast";
import { Globe, RefreshCw, User } from "@/components/icons";
import { SiteLogo } from "@/components/brand/SiteLogos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  disconnectWordPress,
  connectWordPress,
  getWordPressConnection,
  refreshWordPress,
  selectWordPressSite,
  startWordPressOAuth,
} from "@/lib/wordpress.functions";
import {
  ConnectionCard,
  ConnectionFact,
  ConnectionSkeleton,
  ConnectionStatus,
} from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import { IntegrationDetails } from "./IntegrationDetails";
import { useConnectWindow } from "./useConnectWindow";
import { SiteList } from "./WebflowConnector";

export type WordPressConnection = Awaited<ReturnType<typeof getWordPressConnection>>;
export type WordPressLogin = { siteUrl: string; username: string; applicationPassword: string };

const WordPressIcon = ({ className }: { className?: string }) => (
  <SiteLogo provider="wordpress" size={16} className={className} />
);

const bare = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** The two ways in: WordPress.com sign-in, or a site you host yourself. */
function ConnectChoices({
  busy,
  onConnectCom,
  onConnectSelfHosted,
}: {
  busy: boolean;
  onConnectCom: () => void;
  onConnectSelfHosted: (login: WordPressLogin) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"com" | "self">("com");
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [applicationPassword, setApplicationPassword] = useState("");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where your site lives">
        {(
          [
            { id: "com", title: "WordPress.com", hint: "Sign in" },
            { id: "self", title: "My own hosting", hint: "Site address + password" },
          ] as const
        ).map((option) => {
          const selected = kind === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setKind(option.id)}
              className={cn(
                "rounded-[16px] border px-3.5 py-3 text-left transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                selected
                  ? "border-primary/50 bg-primary/[0.07]"
                  : "border-[var(--ds-tile-border)] bg-[var(--ds-well-bg)] hover:bg-[var(--ds-well-bg-hover)]",
              )}
            >
              <span className="block text-[13px] font-semibold text-foreground">
                {option.title}
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {kind === "com" ? (
          <motion.div
            key="com"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <Button className="w-full sm:w-auto" onClick={onConnectCom} loading={busy}>
              Continue with WordPress.com
            </Button>
          </motion.div>
        ) : (
          <motion.form
            data-no-rhythm
            key="self"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onConnectSelfHosted({ siteUrl, username, applicationPassword }).then((ok) => {
                if (ok) setApplicationPassword("");
              });
            }}
          >
            <Input
              required
              type="url"
              placeholder="https://your-site.com"
              aria-label="Site address"
              className="sm:col-span-2"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
            />
            <Input
              required
              placeholder="Username"
              aria-label="WordPress username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              required
              type="password"
              placeholder="Application password"
              aria-label="WordPress application password"
              autoComplete="off"
              value={applicationPassword}
              onChange={(e) => setApplicationPassword(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
              <a
                href="https://wordpress.org/documentation/article/application-passwords/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Where do I get this password?
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <Button type="submit" loading={busy}>
                Connect
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The WordPress card and its details window. Presentational: it only calls back. */
export function WordPressView({
  connection,
  busy,
  onConnectCom,
  onConnectSelfHosted,
  onRefresh,
  onSelectSite,
  onDisconnect,
}: {
  connection: WordPressConnection | null;
  busy: boolean;
  onConnectCom: () => void;
  /** Resolves true when the site was verified and connected. */
  onConnectSelfHosted: (login: WordPressLogin) => Promise<boolean>;
  onRefresh: () => void;
  onSelectSite: (siteId: string) => void;
  onDisconnect: () => void;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const logo = <SiteLogo provider="wordpress" size={24} brand />;

  if (!connection)
    return (
      <ConnectionCard
        label="WordPress connection"
        logo={logo}
        name="WordPress"
        description="Your WordPress pages and posts"
        status={{ tone: "off", text: "Not connected" }}
        actions={
          <Button
            size="sm"
            variant={setupOpen ? "ghost" : "outline"}
            onClick={() => setSetupOpen((v) => !v)}
          >
            {setupOpen ? "Close" : "Connect"}
          </Button>
        }
      >
        {setupOpen && (
          <ConnectChoices
            busy={busy}
            onConnectCom={onConnectCom}
            onConnectSelfHosted={onConnectSelfHosted}
          />
        )}
      </ConnectionCard>
    );

  const active = connection.status === "active";
  const site = connection.selectedSite ?? connection.sites?.[0] ?? null;
  const siteUrl = site?.url || connection.siteUrl || "";
  const siteName = site?.name || connection.siteName || "";
  const account = connection.accountName || connection.username || "";
  const viaCom = connection.authType === "wordpress_com_oauth";

  return (
    <>
      <ConnectionCard
        label="WordPress connection"
        logo={logo}
        name="WordPress"
        description={siteUrl ? bare(siteUrl) : "Choose the site Mellox works on"}
        status={
          !active
            ? { tone: "attention", text: "Needs attention" }
            : siteUrl
              ? { tone: "connected", text: "Connected" }
              : { tone: "attention", text: "Choose a site" }
        }
        facts={
          <>
            {account && <ConnectionFact icon={User}>{account}</ConnectionFact>}
            {siteName && <ConnectionFact icon={Globe}>{siteName}</ConnectionFact>}
          </>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => setDetailsOpen(true)}>
            Manage
          </Button>
        }
      />
      <IntegrationDetails
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        icon={WordPressIcon}
        logo={logo}
        provider={viaCom ? "WordPress.com" : "WordPress"}
        title="WordPress"
        account={account || (siteUrl ? bare(siteUrl) : "WordPress account")}
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
            detail: siteUrl ? "Chosen" : "Not chosen",
            state: siteUrl ? "healthy" : "warning",
          },
          {
            label: "Last checked",
            detail: connection.lastVerifiedAt
              ? new Date(connection.lastVerifiedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : "Not yet",
            state: connection.lastVerifiedAt ? "healthy" : "warning",
          },
        ]}
        footer={
          <>
            <Button variant="outline" onClick={onRefresh} loading={busy}>
              <RefreshCw className="size-3.5" /> Check again
            </Button>
            <Button variant="ghost" onClick={() => setConfirmOpen(true)} disabled={busy}>
              Disconnect
            </Button>
          </>
        }
      >
        {viaCom ? (
          connection.sites.length === 0 ? (
            <p className="ds-well px-4 py-3 text-[13px] text-muted-foreground">
              This account has no WordPress.com sites.
            </p>
          ) : (
            <div>
              <p className="ds-label mb-2">Your sites</p>
              <SiteList
                sites={connection.sites.map((s) => ({
                  id: s.siteId ?? s.id,
                  name: s.name,
                  domain: s.url ?? null,
                  selected: s.selected,
                }))}
                busy={busy}
                onSelect={onSelectSite}
              />
            </div>
          )
        ) : (
          siteUrl && (
            <div className="ds-well flex items-center gap-2.5 px-4 py-3 text-[13px]">
              <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate text-foreground">{bare(siteUrl)}</span>
            </div>
          )
        )}
      </IntegrationDetails>
      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        name="WordPress"
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

export function WordPressConnector({ workspaceId }: { workspaceId: string }) {
  const [connection, setConnection] = useState<WordPressConnection | null | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const connectSelfHosted = async (login: WordPressLogin) => {
    setBusy(true);
    try {
      setConnection(await connectWordPress({ data: { workspaceId, ...login } }));
      toast.success("WordPress connected");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "WordPress could not be verified.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  // WordPress.com signs in in its own window; this hears when it closes.
  const wordpressWindow = useConnectWindow("wordpress", workspaceId, (result) => {
    if (result?.status === "connected") toast.success("WordPress connected");
    void load();
  });
  const connectOAuth = async () => {
    setBusy(true);
    try {
      await wordpressWindow.connect(
        async () =>
          (
            await startWordPressOAuth({
              data: {
                workspaceId,
                returnOrigin: window.location.origin,
                returnPath: `${window.location.pathname}${window.location.search}`,
              },
            })
          ).url,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "WordPress.com could not be reached. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      setConnection(await refreshWordPress({ data: { workspaceId } }));
      toast.success("WordPress checked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "WordPress could not be refreshed.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await disconnectWordPress({ data: { workspaceId, connectionId: connection.connectionId } });
      setConnection(null);
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
      toast.success("Site chosen");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "That WordPress.com site could not be selected.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ConnectionSkeleton label="Loading WordPress" />;
  if (error)
    return (
      <ErrorState
        size="sm"
        title="WordPress didn't load"
        detail={error}
        onRetry={() => void load()}
      />
    );
  return (
    <WordPressView
      connection={connection ?? null}
      busy={busy}
      onConnectCom={() => void connectOAuth()}
      onConnectSelfHosted={connectSelfHosted}
      onRefresh={() => void refresh()}
      onSelectSite={(id) => void selectSite(id)}
      onDisconnect={() => void disconnect()}
    />
  );
}
