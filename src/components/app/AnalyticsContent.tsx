"use client";

// AnalyticsContent — the analytics surface.
//
//   Overview   the two headline numbers and what sits behind them
//   Website    Google Analytics 4
//   Search     Google Search Console
//   Content    what this workspace made and posted
//   Insights   what changed, and what to do about it
//
// The whole surface is gated by AnalyticsGate: until a Google property or
// Search Console site is chosen there is nothing here but a blurred preview
// and one card asking to connect. After that no panel asks again.
import { TABS, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { AnalyticsGate } from "@/components/app/analytics/AnalyticsLock";
import { ContentPanel } from "@/components/app/analytics/ContentPanel";
import { useAnalyticsInvalidation } from "@/components/app/analytics/hooks";
import { InsightsPanel } from "@/components/app/analytics/InsightsPanel";
import { OverviewPanel } from "@/components/app/analytics/OverviewPanel";
import { AnalyticsRangeProvider, RangeBar } from "@/components/app/analytics/range";
import { SearchPanel } from "@/components/app/analytics/SearchPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WebsitePanel } from "@/components/app/analytics/WebsitePanel";
import { SurfaceLayout, SurfacePage } from "@/components/app/surface/SurfaceLayout";

export function AnalyticsContent({
  tab,
  onTabChange,
}: {
  tab: AnalyticsTab;
  onTabChange: (t: AnalyticsTab) => void;
}) {
  useAnalyticsInvalidation();
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <TooltipProvider delayDuration={200}>
      <AnalyticsRangeProvider>
        <SurfaceLayout label="Analytics sections" items={TABS} value={tab} onChange={onTabChange}>
          <SurfacePage title={current.label} subtitle={current.blurb} actions={<RangeBar />}>
            <AnalyticsGate>
              <div key={tab} className="ds-enter">
                {tab === "overview" && <OverviewPanel onTabChange={onTabChange} />}
                {tab === "website" && <WebsitePanel />}
                {tab === "search" && <SearchPanel />}
                {tab === "content" && <ContentPanel />}
                {tab === "insights" && <InsightsPanel />}
              </div>
            </AnalyticsGate>
          </SurfacePage>
        </SurfaceLayout>
      </AnalyticsRangeProvider>
    </TooltipProvider>
  );
}
