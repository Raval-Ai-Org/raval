"use client";

// AnalyticsContent — the analytics surface.
//
//   Overview   the headline numbers from every source that has them
//   Social     the brand's social accounts (no Google needed)
//   Website    Google Analytics 4
//   Search     Google Search Console
//   Content    what this workspace made and posted
//   Insights   what changed, and what to do about it
//
// Overview, Social, Content and Insights are always open. Only Website and
// Search sit behind GoogleGate: a blurred preview and one card asking to
// connect Google, until a property or Search Console site is chosen.
import { TABS, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { GoogleGate } from "@/components/app/analytics/AnalyticsLock";
import { ContentPanel } from "@/components/app/analytics/ContentPanel";
import { useAnalyticsInvalidation } from "@/components/app/analytics/hooks";
import { InsightsPanel } from "@/components/app/analytics/InsightsPanel";
import { OverviewPanel } from "@/components/app/analytics/OverviewPanel";
import { AnalyticsRangeProvider, RangeBar } from "@/components/app/analytics/range";
import { SearchPanel } from "@/components/app/analytics/SearchPanel";
import { SocialPanel } from "@/components/app/analytics/SocialPanel";
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
            <div key={tab} className="ds-enter">
              {tab === "overview" && <OverviewPanel onTabChange={onTabChange} />}
              {tab === "social" && <SocialPanel />}
              {tab === "website" && (
                <GoogleGate>
                  <WebsitePanel />
                </GoogleGate>
              )}
              {tab === "search" && (
                <GoogleGate>
                  <SearchPanel />
                </GoogleGate>
              )}
              {tab === "content" && <ContentPanel />}
              {tab === "insights" && <InsightsPanel />}
            </div>
          </SurfacePage>
        </SurfaceLayout>
      </AnalyticsRangeProvider>
    </TooltipProvider>
  );
}
