"use client";

// Analytics → Ads & leads: numbers from connected business apps —
// Google Ads campaigns (spend, clicks, conversions, last 30 days) and HubSpot
// contacts (new in the last 30 days, and the change). Stored rows only
// (src/server/integrations/reports.server.ts); Refresh reads them again.
//
// An app that isn't connected shows what it would add and connects in a
// sign-in window; the panel re-reads by itself when the window reports back,
// so nobody refreshes the page. `AppsReportView` is presentational.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Megaphone,
  MousePointerClick,
  RefreshCw,
  Spinner,
  Target,
  UserPlus,
  Wallet,
} from "@/components/icons";
import { AppLogo } from "@/components/brand/AppLogo";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useConnectWindow } from "@/components/app/connectors/useConnectWindow";
import { AppUsesList, useOpenAppPlace } from "@/components/app/connectors/AppUses";
import { connectedAppsKey, useConnectedApps } from "@/components/app/connectors/use-connected-apps";
import {
  useOptionalWorkspaceId,
  useOptionalWorkspaceRole,
} from "@/components/workspace/WorkspaceProvider";
import { getAppReports, refreshAppReports, startAppConnect } from "@/lib/integrations.functions";
import {
  changePercent,
  costPerConversion,
  ctrOf,
  type GoogleAdsReport,
  type HubspotReport,
} from "@/lib/integrations/reports";
import { appUses, type AppPlace } from "@/lib/integrations/uses";
import { emitAppEvent } from "@/lib/app-events";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Card } from "./ui";
import { ReportSkeleton } from "./SourceGate";

export type AppsReport = Awaited<ReturnType<typeof getAppReports>>;

const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());

function money(v: number | undefined, currency: string | null) {
  if (v === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: v >= 100 ? 0 : 2,
    }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background/50 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-1 truncate text-[20px] font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ConnectTile({
  app,
  name,
  lead,
  canConnect,
  busy,
  onConnect,
}: {
  app: string;
  name: string;
  lead: string;
  canConnect: boolean;
  busy: boolean;
  onConnect?: () => void;
}) {
  return (
    <Card title={name}>
      <div className="flex items-start gap-3">
        <AppLogo app={app} name={name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-foreground">{lead}</p>
          <div className="@container mt-3">
            <AppUsesList uses={appUses(app).slice(0, 2)} heading="What you get" />
          </div>
          <div className="mt-3">
            {canConnect && onConnect ? (
              <button
                type="button"
                disabled={busy}
                onClick={onConnect}
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              >
                {busy ? <Spinner className="size-4 animate-spin" /> : null}
                {busy ? "Waiting for sign-in…" : `Connect ${name}`}
              </button>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                An admin of this brand can connect {name} in Settings → Connectors.
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function AdsCard({
  report,
  onGo,
}: {
  report: GoogleAdsReport | null;
  onGo: (p: AppPlace) => void;
}) {
  if (!report)
    return (
      <Card title="Google Ads" action={<AppLogo app="googleads" name="Google Ads" size={24} />}>
        <p className="py-6 text-center text-[12px] text-muted-foreground">
          Connected. Mellox is reading your campaigns; numbers appear here in a minute or two.
        </p>
      </Card>
    );
  const t = report.totals;
  const ctr = ctrOf(t);
  const cpa = costPerConversion(t);
  return (
    <Card
      title="Google Ads · last 30 days"
      action={
        <a
          href={`https://ads.google.com/aw/campaigns?__c=${report.customerId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Open Google Ads <ExternalLink className="size-3" />
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={Wallet} label="Spend" value={money(t.cost, report.currency)} />
        <Stat
          icon={MousePointerClick}
          label="Clicks"
          value={n(t.clicks)}
          hint={ctr !== undefined ? `${ctr}% of ${n(t.impressions)} views` : null}
        />
        <Stat icon={Megaphone} label="Times shown" value={n(t.impressions)} />
        <Stat
          icon={Target}
          label="Conversions"
          value={n(t.conversions)}
          hint={cpa !== undefined ? `${money(cpa, report.currency)} each` : null}
        />
      </div>
      {report.campaigns.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[12px]">
            <thead className="text-[11px] text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Campaign</th>
                <th className="pb-2 text-right font-medium">Spend</th>
                <th className="pb-2 text-right font-medium">Clicks</th>
                <th className="pb-2 text-right font-medium">CTR</th>
                <th className="pb-2 text-right font-medium">Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.campaigns.map((c) => {
                const cctr = ctrOf(c);
                return (
                  <tr key={c.id}>
                    <td className="max-w-[240px] py-2 pr-3">
                      <span className="block truncate font-medium text-foreground">{c.name}</span>
                      <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                        {c.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {money(c.cost, report.currency)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{n(c.clicks)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {cctr !== undefined ? `${cctr}%` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{n(c.conversions)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-surface-2 p-3 text-[12px] text-muted-foreground">
          No campaign ran in the last 30 days.{" "}
          <button
            type="button"
            onClick={() => onGo({ kind: "create", choice: "ad" })}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Make an ad in Studio
          </button>{" "}
          and send it to Google Ads from under the finished ad.
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        {report.from} to {report.to} · read {ago(report.measuredAt)} · from Google Ads
      </p>
    </Card>
  );
}

function LeadsCard({
  report,
  onGo,
}: {
  report: HubspotReport | null;
  onGo: (p: AppPlace) => void;
}) {
  if (!report)
    return (
      <Card title="HubSpot" action={<AppLogo app="hubspot" name="HubSpot" size={24} />}>
        <p className="py-6 text-center text-[12px] text-muted-foreground">
          Connected. Mellox is counting your contacts; the number appears here shortly.
        </p>
      </Card>
    );
  const change = changePercent(report.last, report.previous);
  return (
    <Card
      title="HubSpot · new contacts"
      action={<AppLogo app="hubspot" name="HubSpot" size={24} />}
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat
          icon={UserPlus}
          label="Last 30 days"
          value={n(report.last)}
          hint={change === null ? null : `${change > 0 ? "+" : ""}${change}% vs the 30 days before`}
        />
        <Stat icon={UserPlus} label="30 days before" value={n(report.previous ?? undefined)} />
      </div>
      <button
        type="button"
        onClick={() => onGo({ kind: "brain", section: "brand", tab: "goal" })}
        className={cn(dsGhostBtn, "mt-3 h-8 px-3 text-[12px]")}
      >
        <Target className="size-3.5" /> Count these toward a leads goal
      </button>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Read {ago(report.measuredAt)} · contacts created in HubSpot, nothing estimated
      </p>
    </Card>
  );
}

/** Presentational. */
export function AppsReportView({
  view,
  canConnect,
  busy,
  refreshing,
  onConnect,
  onRefresh,
  onGo,
}: {
  view: AppsReport;
  canConnect: boolean;
  busy: string | null;
  refreshing: boolean;
  onConnect: (app: string) => void;
  onRefresh?: () => void;
  onGo: (p: AppPlace) => void;
}) {
  if (!view.enabled)
    return (
      <p className="py-10 text-center text-[13px] text-muted-foreground">
        Connected apps aren't on for this brand.
      </p>
    );
  const any = view.googleads.connected || view.hubspot.connected;
  return (
    <div className="space-y-4">
      {any && onRefresh ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
            className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            {refreshing ? "Reading…" : "Refresh"}
          </button>
        </div>
      ) : null}
      {view.googleads.connected ? (
        <AdsCard report={view.googleads.report} onGo={onGo} />
      ) : (
        <ConnectTile
          app="googleads"
          name="Google Ads"
          lead="See what your ads cost and bring in, next to your posts, and turn Studio ads into campaigns."
          canConnect={canConnect}
          busy={busy === "googleads"}
          onConnect={() => onConnect("googleads")}
        />
      )}
      {view.hubspot.connected ? (
        <LeadsCard report={view.hubspot.report} onGo={onGo} />
      ) : (
        <ConnectTile
          app="hubspot"
          name="HubSpot"
          lead="Count the leads your marketing brings in, measured from your CRM."
          canConnect={canConnect}
          busy={busy === "hubspot"}
          onConnect={() => onConnect("hubspot")}
        />
      )}
    </div>
  );
}

const reportsKey = (ws: string) => ["app-reports", ws] as const;

export function AppsPanel() {
  const ws = useOptionalWorkspaceId();
  const role = useOptionalWorkspaceRole();
  const qc = useQueryClient();
  const apps = useConnectedApps(ws);
  const go = useOpenAppPlace();
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery({
    queryKey: reportsKey(ws ?? "none"),
    queryFn: () => getAppReports({ data: { workspaceId: ws! } }),
    enabled: !!ws,
    staleTime: 60_000,
    // A just-connected app is read in the background: look again until it lands.
    refetchInterval: (q) => {
      const d = q.state.data;
      const waiting =
        !!d &&
        ((d.googleads.connected && !d.googleads.report) ||
          (d.hubspot.connected && !d.hubspot.report));
      return waiting ? 8_000 : false;
    },
  });

  const again = () => {
    if (!ws) return;
    void qc.invalidateQueries({ queryKey: reportsKey(ws) });
    void qc.invalidateQueries({ queryKey: connectedAppsKey(ws) });
  };
  const appWindow = useConnectWindow("apps", ws, (result) => {
    setBusy(null);
    if (result?.status === "connected") {
      toast.success(result.accounts?.[0] ? `Connected ${result.accounts[0]}` : "Connected");
      emitAppEvent("connections:changed");
    } else if (result?.status === "error") toast.error("That connection didn't finish. Try again.");
    again();
  });

  if (!ws) return null;
  if (query.isLoading && !query.data) return <ReportSkeleton />;
  if (!query.data)
    return (
      <p className="py-10 text-center text-[13px] text-muted-foreground">
        Couldn't read connected apps. Try again in a moment.
      </p>
    );

  const admin = role === "owner" || role === "admin";
  const connect = async (app: string) => {
    setBusy(app);
    try {
      await appWindow.connect(
        async () =>
          (
            await startAppConnect({
              data: {
                workspaceId: ws,
                app,
                returnOrigin: window.location.origin,
                returnPath: `${window.location.pathname}${window.location.search}`,
              },
            })
          ).url,
      );
    } catch (cause) {
      setBusy(null);
      toast.error(cause instanceof Error ? cause.message : "Couldn't open the sign-in.");
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(reportsKey(ws), await refreshAppReports({ data: { workspaceId: ws } }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't refresh.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AppsReportView
      view={query.data}
      canConnect={admin && apps.canConnect}
      busy={busy}
      refreshing={refreshing}
      onConnect={(app) => void connect(app)}
      onRefresh={role !== "viewer" ? () => void refresh() : undefined}
      onGo={go}
    />
  );
}
