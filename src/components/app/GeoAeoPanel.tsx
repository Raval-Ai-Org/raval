"use client";

// AI Visibility — Mellox's GEO / AEO / SEO intelligence surface. Scans run on
// the server (src/server/geo); this panel starts them, follows their progress
// and presents scores, explainable findings, page evidence, history and
// scheduled monitoring.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  History,
  LayoutDashboard,
  ListTree,
  FileText,
} from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { emitAppEvent } from "@/lib/app-events";
import { getGeoSettings } from "@/lib/geo.functions";
import type { GeoScanMode } from "@/lib/geo/contracts";
import { cn } from "@/lib/utils";
import { FindingsTab, type FindingsFilter } from "./geo/FindingsTab";
import { HistoryTab } from "./geo/HistoryTab";
import { MonitoringTab } from "./geo/MonitoringTab";
import { OverviewTab } from "./geo/OverviewTab";
import { PagesTab } from "./geo/PagesTab";
import { ScanBar, ScanIntro, ScanProgress } from "./geo/ScanControls";
import { displayUrl, hostOf, relativeTime } from "./geo/geo-ui";
import { useGeoScans } from "./geo/use-geo-scans";

type TabId = "overview" | "findings" | "pages" | "history" | "monitoring";

const TAB_ICON = {
  overview: LayoutDashboard,
  findings: ListTree,
  pages: FileText,
  history: History,
  monitoring: CalendarClock,
};

type AutoRunProps = {
  /** Non-zero while chat or a suggestion has asked for a scan ("scan my site"). */
  autoRunToken?: number;
  /** Called once the requested scan has been started, so a remount never repeats it. */
  onAutoRunHandled?: () => void;
};

export function GeoAeoPanel({
  workspaceId,
  autoRunToken,
  onAutoRunHandled,
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
    />
  );
}

function Panel({
  workspaceId,
  autoRunToken,
  onAutoRunHandled,
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
  const [tab, setTab] = useState<TabId>("overview");
  const [findingsFilter, setFindingsFilter] = useState<FindingsFilter>({});

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
  const hint = !brandUrl ? (
    <>
      No website saved in Brand DNA yet.{" "}
      <button
        type="button"
        onClick={() => emitAppEvent("open:brand-dna")}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Add it
      </button>{" "}
      so every Mellox agent can use it.
    </>
  ) : targetHost && targetHost !== brandHost ? (
    <>
      Scanning a different site than your Brand DNA ({brandHost}).{" "}
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
  ) : (
    "60+ checks across AI crawler access, technical SEO, schema, answer-ready content, trust and rendering."
  );

  return (
    <section aria-label="AI visibility" className="space-y-5 px-1 pb-2">
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

      {scans.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive"
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
      )}

      {scans.active && <ScanProgress scan={scans.active} onCancel={() => void scans.cancel()} />}

      {scans.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : !current ? (
        !scans.active && <ScanIntro hasUrl={!!target} maxPages={settings?.maxPages ?? null} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          {viewingOlder && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2 text-[12.5px] text-muted-foreground">
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
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="h-10 rounded-full bg-muted/70 p-1">
              {(["overview", "findings", "pages", "history", "monitoring"] as const).map((id) => {
                const Icon = TAB_ICON[id];
                const count =
                  id === "findings"
                    ? current.report?.counts.findings
                    : id === "pages"
                      ? current.report?.counts.pagesCrawled
                      : undefined;
                return (
                  <TabsTrigger
                    key={id}
                    value={id}
                    className={cn("gap-1.5 rounded-full px-3 text-[12.5px] capitalize")}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {id}
                    {typeof count === "number" && (
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          <TabsContent value="overview" className="mt-4">
            {current.report ? (
              <OverviewTab
                scan={current}
                previousScore={previousScore}
                sparkValues={sparkValues}
                brandName={dna.brandName || null}
                probesAvailable={!!settings?.probesAvailable}
                onOpenFindings={openFindings}
              />
            ) : (
              <EmptyState
                size="sm"
                title="This scan has no report"
                description="Run a new scan to refresh the results."
              />
            )}
          </TabsContent>
          <TabsContent value="findings" className="mt-4">
            <FindingsTab
              workspaceId={workspaceId}
              scan={current}
              brandName={dna.brandName || null}
              filter={findingsFilter}
              onFilterChange={setFindingsFilter}
            />
          </TabsContent>
          <TabsContent value="pages" className="mt-4">
            <PagesTab workspaceId={workspaceId} scan={current} />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <HistoryTab
              workspaceId={workspaceId}
              history={scans.history}
              currentId={current.id}
              onView={(id) => {
                void scans.view(id);
                setTab("overview");
              }}
            />
          </TabsContent>
          <TabsContent value="monitoring" className="mt-4">
            <MonitoringTab workspaceId={workspaceId} defaultUrl={current.origin} />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
