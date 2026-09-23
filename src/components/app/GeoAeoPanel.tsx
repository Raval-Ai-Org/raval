"use client";

// AI Visibility — Mellox's GEO / AEO / SEO intelligence surface. Scans run on
// the server (src/server/geo); this panel starts them, follows their progress
// and presents scores, explainable findings, page evidence, history and
// scheduled monitoring.
//
// Layout: a navigation rail (SurfaceLayout) with one page per question —
// how am I doing (Overview), what is wrong (Issues), which pages (Pages), how
// has it moved (History) and keep watching (Monitoring). Before the first scan
// there is nothing to navigate, so the panel is a single centred scan box.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  FileText,
  History,
  LayoutDashboard,
  ListTree,
  Wand,
} from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { emitAppEvent } from "@/lib/app-events";
import { getGeoSettings } from "@/lib/geo.functions";
import type { GeoScanMode } from "@/lib/geo/contracts";
import { cn } from "@/lib/utils";
import { SurfaceLayout, SurfacePage, type SurfaceNavItem } from "./surface/SurfaceLayout";
import { FindingsTab, type FindingsFilter } from "./geo/FindingsTab";
import { HistoryTab } from "./geo/HistoryTab";
import { MonitoringTab } from "./geo/MonitoringTab";
import { buildReport, OverviewTab } from "./geo/OverviewTab";
import { PagesTab } from "./geo/PagesTab";
import { ScanBar, ScanIntro, ScanProgress } from "./geo/ScanControls";
import {
  copyText,
  displayUrl,
  ghostBtn,
  hostOf,
  primaryBtn,
  relativeTime,
  ScoreRing,
} from "./geo/geo-ui";
import { useGeoScans } from "./geo/use-geo-scans";

type TabId = "overview" | "findings" | "pages" | "history" | "monitoring";

type AutoRunProps = {
  /** Non-zero while chat or a suggestion has asked for a scan ("scan my site"). */
  autoRunToken?: number;
  /** Called once the requested scan has been started, so a remount never repeats it. */
  onAutoRunHandled?: () => void;
  /** Open on the Findings tab with this filter (deep link). */
  initialFindings?: FindingsFilter;
};

export function GeoAeoPanel({
  workspaceId,
  autoRunToken,
  onAutoRunHandled,
  initialFindings,
}: { workspaceId: string | null } & AutoRunProps) {
  if (!workspaceId) {
    return (
      <EmptyState
        title="Select a workspace"
        description="AI Visibility scans belong to a workspace."
      />
    );
  }
  return (
    <Panel
      key={workspaceId}
      workspaceId={workspaceId}
      autoRunToken={autoRunToken}
      onAutoRunHandled={onAutoRunHandled}
      initialFindings={initialFindings}
    />
  );
}

function Panel({
  workspaceId,
  autoRunToken,
  onAutoRunHandled,
  initialFindings,
}: { workspaceId: string } & AutoRunProps) {
  const { dna } = useBrandDna(workspaceId);
  const brandUrl = dna.websiteUrl?.trim() ?? "";
  const scans = useGeoScans(workspaceId);
  const [settings, setSettings] = useState<{ maxPages: number; probesAvailable: boolean } | null>(
    null,
  );
  const [urlInput, setUrlInput] = useState("");
  const urlTouched = useRef(false);
  const [mode, setMode] = useState<GeoScanMode>("full");
  const [probes, setProbes] = useState(false);
  const [tab, setTab] = useState<TabId>(initialFindings ? "findings" : "overview");
  const [findingsFilter, setFindingsFilter] = useState<FindingsFilter>(initialFindings ?? {});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getGeoSettings({ data: { workspaceId } })
      .then((s) => setSettings({ maxPages: s.maxPages, probesAvailable: s.probesAvailable }))
      .catch(() => setSettings(null));
  }, [workspaceId]);

  // Prefill: the site last scanned here, else the Brand DNA website.
  const lastUrl = scans.current?.url ?? scans.active?.url ?? scans.history?.[0]?.url ?? "";
  useEffect(() => {
    if (!urlTouched.current) setUrlInput(lastUrl ? displayUrl(lastUrl) : brandUrl);
  }, [lastUrl, brandUrl]);

  const target = urlInput.trim() || brandUrl;
  const busy = scans.starting || !!scans.active;

  const run = (trigger: "manual" | "chat" = "manual") => {
    if (!target || busy) return;
    setTab("overview");
    void scans.start({ url: target, mode, probes: probes && !!settings?.probesAvailable, trigger });
  };

  // Chat / suggestions: run once per request, including a request that was
  // already pending when this panel mounted. The dialog clears the token after.
  const runRef = useRef(run);
  runRef.current = run;
  const handledToken = useRef(0);
  const readyToRun = !scans.loading && !!target;
  useEffect(() => {
    if (!autoRunToken || autoRunToken === handledToken.current || !readyToRun) return;
    handledToken.current = autoRunToken;
    runRef.current("chat");
    onAutoRunHandled?.();
  }, [autoRunToken, readyToRun, onAutoRunHandled]);

  const openFindings = (filter: FindingsFilter) => {
    setFindingsFilter(filter);
    setTab("findings");
  };

  const current = scans.current;
  const sameHostHistory = useMemo(() => {
    if (!current || !scans.history) return [];
    return scans.history.filter(
      (h) => h.host === current.host && h.status === "succeeded" && h.overallScore !== null,
    );
  }, [current, scans.history]);
  const previousScore = useMemo(() => {
    if (!current) return null;
    const older = sameHostHistory.filter((h) => h.createdAt < current.createdAt);
    return older[0]?.overallScore ?? null;
  }, [sameHostHistory, current]);
  const sparkValues = useMemo(
    () =>
      sameHostHistory
        .filter((h) => !current || h.createdAt <= current.createdAt)
        .slice(0, 12)
        .reverse()
        .map((h) => h.overallScore as number),
    [sameHostHistory, current],
  );
  const latestSucceededId = scans.history?.find((h) => h.status === "succeeded")?.id ?? null;
  const viewingOlder = !!current && !!latestSucceededId && current.id !== latestSucceededId;

  const brandHost = brandUrl ? hostOf(brandUrl) : "";
  const targetHost = target ? hostOf(target) : "";
  // Websites this workspace has scanned (plus its Brand DNA site), newest first.
  const sites = useMemo(() => {
    const out = new Map<string, { host: string; url: string; latestId: string | null }>();
    for (const h of scans.history ?? []) {
      if (!out.has(h.host)) {
        out.set(h.host, { host: h.host, url: h.url, latestId: null });
      }
      const entry = out.get(h.host)!;
      if (!entry.latestId && h.status === "succeeded") entry.latestId = h.id;
    }
    if (brandHost && !out.has(brandHost))
      out.set(brandHost, { host: brandHost, url: brandUrl, latestId: null });
    return [...out.values()];
  }, [scans.history, brandHost, brandUrl]);

  // One short line under the scan box, only when there is something to act on.
  const hint = !brandUrl ? (
    <>
      No website in Brand DNA yet.{" "}
      <button
        type="button"
        onClick={() => emitAppEvent("open:brand-dna")}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Add it
      </button>
    </>
  ) : targetHost && targetHost !== brandHost ? (
    <>
      Not your Brand DNA site.{" "}
      <button
        type="button"
        onClick={() => {
          urlTouched.current = true;
          setUrlInput(brandUrl);
        }}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Use {brandHost}
      </button>
    </>
  ) : null;

  const scanBar = (
    <ScanBar
      url={urlInput}
      onUrlChange={(v) => {
        urlTouched.current = true;
        setUrlInput(v);
      }}
      mode={mode}
      onModeChange={setMode}
      maxPages={settings?.maxPages ?? null}
      probesAvailable={!!settings?.probesAvailable}
      probes={probes}
      onProbesChange={setProbes}
      busy={busy}
      starting={scans.starting}
      canRescan={!!current && targetHost === current.host}
      onRun={() => run()}
      hint={hint}
    />
  );

  const errorBanner = scans.error && (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
      <span className="min-w-0 flex-1">{scans.error}</span>
      <button
        type="button"
        onClick={() => scans.setError(null)}
        className="shrink-0 text-[12px] font-medium underline-offset-2 hover:underline"
      >
        Dismiss
      </button>
    </div>
  );

  if (scans.loading) {
    return (
      <div className="flex h-full">
        <div className="hidden w-[216px] shrink-0 space-y-2 border-r border-border/60 p-4 md:block">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-full" />
          ))}
        </div>
        <div className="flex-1 space-y-4 p-7">
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-52 w-full rounded-[20px]" />
          <Skeleton className="h-28 w-full rounded-[20px]" />
        </div>
      </div>
    );
  }

  // ── First scan: one centred box, nothing else to look at yet ──────────────
  if (!current) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-8 sm:pt-14">
          {errorBanner}
          {scans.active ? (
            <ScanProgress scan={scans.active} onCancel={() => void scans.cancel()} />
          ) : (
            <ScanIntro hasUrl={!!target}>{scanBar}</ScanIntro>
          )}
        </div>
      </div>
    );
  }

  const report = current.report;
  const nav: SurfaceNavItem<TabId>[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "findings", label: "Issues", icon: ListTree, count: report?.counts.findings },
    { id: "pages", label: "Pages", icon: FileText, count: report?.counts.pagesCrawled },
    { id: "history", label: "History", icon: History },
    { id: "monitoring", label: "Monitoring", icon: CalendarClock },
  ];

  const siteCard = (
    <div className="rounded-[18px] bg-foreground/[0.04] p-3">
      <div className="flex items-center gap-3">
        {current.overallScore !== null ? (
          <ScoreRing value={current.overallScore} size={44} />
        ) : (
          <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-[12px] text-muted-foreground">
            —
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{current.host}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {relativeTime(current.completedAt ?? current.createdAt)}
          </div>
        </div>
      </div>
      {sites.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Websites">
          {sites.map((s) => {
            const selected = current.host === s.host;
            return (
              <button
                key={s.host}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                title={s.latestId ? s.host : `${s.host} · not scanned yet`}
                onClick={() => {
                  urlTouched.current = true;
                  setUrlInput(displayUrl(s.url));
                  if (s.latestId) void scans.view(s.latestId);
                  setTab("overview");
                }}
                className={cn(
                  "max-w-full truncate rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-60",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-foreground/[0.06] text-muted-foreground hover:text-foreground",
                  !s.latestId && !selected && "opacity-70",
                )}
              >
                {s.host}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const pageTitle: Record<TabId, string> = {
    overview: "Overview",
    findings: "Issues",
    pages: "Pages",
    history: "History",
    monitoring: "Monitoring",
  };
  // Inside Issues, a finding or the fix-all flow is its own screen with a back button.
  const issuesSubview = tab === "findings" && (findingsFilter.fixAll || findingsFilter.findingId);

  const actions =
    tab === "overview" && report ? (
      <button
        type="button"
        onClick={async () => {
          if (await copyText(buildReport(current))) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }
        }}
        className={cn(ghostBtn, "h-9 px-3.5 text-[12.5px]")}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy report"}
      </button>
    ) : tab === "findings" && !issuesSubview ? (
      <button
        type="button"
        onClick={() => openFindings({ fixAll: true })}
        className={cn(primaryBtn, "h-9 px-4 text-[12.5px]")}
      >
        <Wand className="h-3.5 w-3.5" /> Fix all
      </button>
    ) : undefined;

  return (
    <section aria-label="AI visibility" className="h-full">
      <SurfaceLayout
        label="AI Visibility"
        items={nav}
        value={tab}
        onChange={(id) => {
          if (id === "findings") setFindingsFilter({});
          setTab(id);
        }}
        railTop={siteCard}
      >
        <SurfacePage
          title={issuesSubview ? undefined : pageTitle[tab]}
          actions={issuesSubview ? undefined : actions}
        >
          {errorBanner}
          {tab === "overview" && (
            <div className="mb-5 space-y-4">
              {scanBar}
              {scans.active && (
                <ScanProgress scan={scans.active} onCancel={() => void scans.cancel()} />
              )}
            </div>
          )}
          {viewingOlder && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-full bg-foreground/[0.05] px-4 py-2 text-[12.5px] text-muted-foreground">
              Viewing the scan from {relativeTime(current.createdAt)}.
              <button
                type="button"
                onClick={() => latestSucceededId && void scans.view(latestSucceededId)}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Back to latest
              </button>
            </div>
          )}
          <div key={tab} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
            {tab === "overview" &&
              (report ? (
                <OverviewTab
                  workspaceId={workspaceId}
                  scan={current}
                  previousScore={previousScore}
                  sparkValues={sparkValues}
                  brandName={dna.brandName || null}
                  onOpenFindings={openFindings}
                />
              ) : (
                <EmptyState
                  size="sm"
                  title="This scan has no report"
                  description="Run a new scan to refresh the results."
                />
              ))}
            {tab === "findings" && (
              <FindingsTab
                workspaceId={workspaceId}
                scan={current}
                brandName={dna.brandName || null}
                filter={findingsFilter}
                onFilterChange={setFindingsFilter}
              />
            )}
            {tab === "pages" && <PagesTab workspaceId={workspaceId} scan={current} />}
            {tab === "history" && (
              <HistoryTab
                workspaceId={workspaceId}
                history={scans.history}
                currentId={current.id}
                onView={(id) => {
                  void scans.view(id);
                  setTab("overview");
                }}
              />
            )}
            {tab === "monitoring" && (
              <MonitoringTab
                workspaceId={workspaceId}
                defaultUrl={current.origin}
                probesAvailable={!!settings?.probesAvailable}
              />
            )}
          </div>
        </SurfacePage>
      </SurfaceLayout>
    </section>
  );
}
