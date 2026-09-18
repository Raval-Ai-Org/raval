"use client";

// GoogleConnectCard — connect Google, choose the GA4 property and Search
// Console site, see sync progress, sync now, disconnect. Used on the Website
// and Search tabs and in Settings → Connections. Admins connect and choose;
// editors can sync; viewers read.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  GoogleIcon,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "@/components/icons";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent } from "@/lib/app-events";
import type { AnalyticsSourceView, GoogleConnectionView } from "@/lib/analytics/types";
import {
  disconnectGoogle,
  listGa4Properties,
  listGscSites,
  removeAnalyticsSource,
  selectGa4Property,
  selectGscSite,
  startGoogleConnect,
} from "@/lib/google-analytics.functions";
import { useServerFn } from "@/lib/use-server-fn";
import { cn } from "@/lib/utils";
import { analyticsKeys, useGoogleConnection, useSyncNow } from "./hooks";

const roleRank = { viewer: 1, editor: 2, admin: 3, owner: 4 } as const;

export function AnalyticsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="3" y="17" width="6" height="11" rx="1.5" fill="#f9ab00" />
      <rect x="13" y="10" width="6" height="18" rx="1.5" fill="#e37400" />
      <rect x="23" y="3" width="6" height="25" rx="1.5" fill="#f9ab00" />
      <path
        d="M6 14.5 16 8l10-4"
        fill="none"
        stroke="#4285f4"
        strokeLinecap="round"
        strokeWidth="2.5"
      />
      <circle cx="6" cy="14.5" r="2" fill="#4285f4" />
      <circle cx="16" cy="8" r="2" fill="#4285f4" />
      <circle cx="26" cy="4" r="2" fill="#4285f4" />
    </svg>
  );
}

export function SearchConsoleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="9" fill="none" stroke="#4285f4" strokeWidth="4" />
      <path d="m21 21 7 7" stroke="#34a853" strokeLinecap="round" strokeWidth="4" />
      <path
        d="M8 14a6 6 0 0 1 6-6"
        fill="none"
        stroke="#ea4335"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="14" cy="14" r="2.5" fill="#fbbc04" />
    </svg>
  );
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

function connectedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function useConnect() {
  const ws = useWorkspace();
  const start = useServerFn(startGoogleConnect);
  return useMutation({
    mutationFn: async () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      const returnPath = `${url.pathname}?tab=${new URL(window.location.href).searchParams.get("tab") || "website"}`;
      const { url: authUrl } = await start({
        data: { workspaceId: ws.id, returnOrigin: window.location.origin, returnPath },
      });
      window.location.assign(authUrl);
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Couldn't start the Google connection"),
  });
}

export function ConnectGoogleButton({ label = "Connect Google" }: { label?: string }) {
  const connect = useConnect();
  const ws = useWorkspace();
  if (roleRank[ws.role] < roleRank.admin)
    return (
      <p className="text-[12px] text-muted-foreground">Ask a workspace admin to connect Google.</p>
    );
  return (
    <Button onClick={() => connect.mutate()} loading={connect.isPending} className="gap-2">
      <GoogleIcon className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}

function RunStatus({ source }: { source: AnalyticsSourceView }) {
  const run = source.run;
  if (run && (run.status === "queued" || run.status === "running")) {
    const waiting = run.nextAttemptAt && Date.parse(run.nextAttemptAt) > Date.now() + 5000;
    return (
      <div className="mt-3 space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-[11px] text-foreground/80">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          <span className="font-medium">
            {waiting
              ? "Waiting to retry"
              : run.trigger === "initial"
                ? "Importing your history"
                : "Keeping data current"}
          </span>
          <span className="ml-auto tabular-nums text-muted-foreground">
            {Math.round(run.progress * 100)}%
          </span>
        </div>
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(run.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.max(4, run.progress * 100)}%` }}
          />
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          {waiting
            ? `Next attempt ${new Date(run.nextAttemptAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
            : run.trigger === "initial"
              ? "Mellox is loading the last 180 days in the background."
              : "Recent days are refreshed automatically."}
        </p>
      </div>
    );
  }
  if (source.status !== "active")
    return (
      <p className="mt-1.5 flex items-start gap-1 text-[11px] text-destructive">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {source.lastError ?? "Mellox can't read this any more. Choose another or reconnect Google."}
      </p>
    );
  if (run?.status === "failed")
    return (
      <p className="mt-1.5 flex items-start gap-1 text-[11px] text-destructive">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {run.errorMessage ?? "The last sync failed."}
      </p>
    );
  return (
    <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <CheckCircle className="h-3.5 w-3.5 text-success" aria-hidden />
      Last synced {relative(source.lastSyncedAt)}
    </p>
  );
}

function SourcePicker({
  kind,
  view,
  canChoose,
}: {
  kind: "ga4_property" | "gsc_site";
  view: GoogleConnectionView;
  canChoose: boolean;
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const current = kind === "ga4_property" ? view.ga4 : view.gsc;
  const allowed =
    kind === "ga4_property"
      ? view.connection?.scopes.analytics
      : view.connection?.scopes.searchConsole;
  const [picking, setPicking] = useState(false);
  const listProps = useServerFn(listGa4Properties);
  const listSites = useServerFn(listGscSites);
  const selectProp = useServerFn(selectGa4Property);
  const selectSite = useServerFn(selectGscSite);
  const remove = useServerFn(removeAnalyticsSource);
  const choosing = canChoose && allowed && (picking || !current);

  const options = useQuery({
    queryKey: [...analyticsKeys.google(ws.id), "options", kind],
    enabled: !!choosing,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      kind === "ga4_property"
        ? (await listProps({ data: { workspaceId: ws.id } })).map((p) => ({
            value: p.propertyId,
            label: p.displayName,
            group: p.accountName,
          }))
        : (await listSites({ data: { workspaceId: ws.id } })).map((s) => ({
            value: s.siteUrl,
            label:
              s.siteUrl.replace(/^sc-domain:/, "") +
              (s.siteUrl.startsWith("sc-domain:") ? " (domain)" : ""),
            group: "Search Console",
          })),
  });

  const choose = useMutation({
    mutationFn: (value: string) =>
      kind === "ga4_property"
        ? selectProp({ data: { workspaceId: ws.id, propertyId: value } })
        : selectSite({ data: { workspaceId: ws.id, siteUrl: value } }),
    onSuccess: () => {
      setPicking(false);
      void qc.invalidateQueries({ queryKey: analyticsKeys.all(ws.id) });
      emitAppEvent("analytics:changed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save your choice"),
  });

  const removeMut = useMutation({
    mutationFn: () => remove({ data: { workspaceId: ws.id, kind } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: analyticsKeys.all(ws.id) });
      emitAppEvent("analytics:changed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove it"),
  });

  const isGa4 = kind === "ga4_property";
  const title = isGa4 ? "Google Analytics 4 property" : "Search Console site";
  const description = isGa4
    ? "Traffic, engagement, channels, landing pages, countries and devices."
    : "Search clicks, impressions, queries, pages, countries and devices.";
  const Mark = isGa4 ? AnalyticsMark : SearchConsoleMark;
  const groups = new Map<string, Array<{ value: string; label: string }>>();
  for (const o of options.data ?? []) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);

  return (
    <div className="flex min-h-[164px] flex-col rounded-xl border border-border/70 bg-background/35 p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-white/10">
          <Mark className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[12px] font-semibold">{title}</div>
            <span className="rounded-full border border-border/70 bg-card/80 px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground">
              {isGa4 ? "Website traffic" : "Organic search"}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
          {current ? (
            <div className="mt-3 space-y-1.5">
              <div className="truncate rounded-lg border border-border/70 bg-secondary/60 px-2.5 py-2 text-[12px] font-semibold" title={current.externalId}>
                {current.displayName}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                {current.accountName && <span className="truncate">{current.accountName}</span>}
                {current.siteHost && <span className="truncate">{current.siteHost}</span>}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-[11px] text-muted-foreground">
              {allowed ? "Not chosen" : "Access not allowed"}
            </div>
          )}
        </div>
        {canChoose && allowed && current && !picking && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
              Change
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={removeMut.isPending}
              onClick={() => removeMut.mutate()}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
      {current && !picking && <RunStatus source={current} />}
      {choosing && (
        <div className="mt-2 space-y-1.5">
          {options.isLoading ? (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading from Google…
            </p>
          ) : options.error ? (
            <p className="text-[12px] text-destructive">
              {options.error instanceof Error ? options.error.message : "Couldn't load the list"}
            </p>
          ) : (options.data?.length ?? 0) === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              {isGa4
                ? "This Google account has no GA4 properties."
                : "This Google account has no verified Search Console sites."}
            </p>
          ) : (
            <Select
              disabled={choose.isPending}
              onValueChange={(v) => choose.mutate(v)}
              value={undefined}
            >
              <SelectTrigger className="h-9 text-[12.5px]">
                <SelectValue placeholder={isGa4 ? "Choose a property" : "Choose a site"} />
              </SelectTrigger>
              <SelectContent>
                {[...groups.entries()].map(([group, items]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {items.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )}
          {picking && (
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          )}
          {choose.isPending && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking access…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function GoogleConnectCard({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { data: view, isLoading, error, refetch } = useGoogleConnection();
  const sync = useSyncNow();
  const disconnect = useServerFn(disconnectGoogle);
  const [confirming, setConfirming] = useState(false);
  const isAdmin = roleRank[ws.role] >= roleRank.admin;
  const isEditor = roleRank[ws.role] >= roleRank.editor;

  const disconnectMut = useMutation({
    mutationFn: () => disconnect({ data: { workspaceId: ws.id } }),
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: analyticsKeys.all(ws.id) });
      emitAppEvent("analytics:changed");
      emitAppEvent("connections:changed");
      toast.success("Google disconnected");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't disconnect"),
  });

  if (isLoading)
    return (
      <div
        className={cn("h-40 animate-pulse rounded-2xl border border-border bg-muted/30", className)}
        aria-busy="true"
      />
    );
  if (error || !view)
    return (
      <div
        className={cn(
          "rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-[12.5px]",
          className,
        )}
      >
        Couldn't load your Google connection.{" "}
        <button className="underline" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );

  const conn = view.connection;
  const busy = [view.ga4?.run, view.gsc?.run].some(
    (r) => r && (r.status === "queued" || r.status === "running"),
  );

  return (
    <section
      className={cn("overflow-hidden rounded-2xl border border-border bg-card/60", className)}
    >
      <header className="border-b border-border/70 bg-background/35 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-white/10">
              <GoogleIcon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">Google data connections</h2>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  conn?.status === "active" ? "border-success/25 bg-success/10 text-success" : "border-border/70 bg-card/70 text-muted-foreground",
                )}>
                  {conn?.status === "active" ? <ShieldCheck className="size-3" aria-hidden /> : <Clock className="size-3" aria-hidden />}
                  {conn?.status === "active" ? "Read-only access" : "Not connected"}
                </span>
              </div>
              {conn ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {conn.status === "active" ? (
                    <span className="inline-flex items-center gap-1"><CheckCircle className="size-3 text-success" aria-hidden /> Connected account</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-3" aria-hidden /> Needs attention</span>
                  )}
                  <span className="inline-flex min-w-0 items-center gap-1 truncate"><Mail className="size-3" aria-hidden /> {conn.email}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden /> Connected {connectedDate(conn.connectedAt)}</span>
                </div>
              ) : (
                <p className="text-[11.5px] text-muted-foreground">
                  Connect your own Google account and choose the properties Mellox should read.
                </p>
              )}
            </div>
          </div>
          {conn && (
            <div className="flex flex-wrap gap-1.5">
              {isEditor && conn.status === "active" && (view.ga4 || view.gsc) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  loading={sync.isPending}
                  disabled={busy}
                  onClick={() =>
                    sync.mutate(undefined, {
                      onError: (e) =>
                        toast.error(e instanceof Error ? e.message : "Couldn't start the sync"),
                    })
                  }
                >
                  {!sync.isPending && (
                    <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
                  )}
                  {busy ? "Syncing" : "Sync now"}
                </Button>
              )}
              {isAdmin && (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                  Disconnect
                </Button>
              )}
            </div>
          )}
        </div>
        {!compact && !conn && view.configured && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden />
              Your Google data stays in this workspace. Mellox never edits Google properties.
            </p>
            <p className="text-[10.5px] text-muted-foreground">Secure OAuth + encrypted tokens</p>
          </div>
        )}
      </header>

      {!view.configured && !conn ? (
        <div className="flex items-start gap-2 border-t border-border/70 bg-amber-500/5 p-4 text-[12px] text-amber-200/90 sm:p-5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>
          Google isn&apos;t set up on this Mellox server yet. An admin needs to add the Google OAuth
          settings.
          </p>
        </div>
      ) : !conn ? (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/35 p-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm">
                <AnalyticsMark className="size-7" />
              </span>
              <div>
                <p className="text-[12px] font-semibold">Google Analytics 4</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Understand visits, engagement and the channels bringing people to your site.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/35 p-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm">
                <SearchConsoleMark className="size-7" />
              </span>
              <div>
                <p className="text-[12px] font-semibold">Google Search Console</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  See the queries, pages and countries that bring you organic search visibility.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div>
              <p className="text-[12px] font-medium">One connection, two useful views</p>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
                Connect once, then select a GA4 property and Search Console site. You can change
                either selection later.
              </p>
            </div>
            <ConnectGoogleButton />
          </div>
        </div>
      ) : conn.status !== "active" ? (
        <div className="space-y-3 border-t border-border/70 bg-destructive/5 p-4 sm:p-5">
          <p className="flex items-start gap-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {conn.lastError ?? "Google access expired. Reconnect to keep your data up to date."}
            </span>
          </p>
          <ConnectGoogleButton label="Reconnect Google" />
        </div>
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <SourcePicker kind="ga4_property" view={view} canChoose={isAdmin} />
          <SourcePicker kind="gsc_site" view={view} canChoose={isAdmin} />
          {(!conn.scopes.analytics || !conn.scopes.searchConsole) && isAdmin && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 sm:col-span-2">
              <p className="mb-2 text-[11.5px] text-amber-200/90">
                Some access wasn&apos;t allowed. Reconnect and tick both boxes on Google&apos;s
                screen.
              </p>
              <ConnectGoogleButton label="Reconnect Google" />
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
            <AlertDialogDescription>
              Mellox removes its access and deletes the Google Analytics and Search Console data it
              stored for this workspace. You can connect again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disconnectMut.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnectMut.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
