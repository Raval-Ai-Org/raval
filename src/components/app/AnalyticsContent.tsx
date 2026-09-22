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
import { AnimatePresence, motion } from "framer-motion";
import { AnalyticsTabs, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { AnalyticsGate } from "@/components/app/analytics/AnalyticsLock";
import { ContentPanel } from "@/components/app/analytics/ContentPanel";
import { useAnalyticsInvalidation } from "@/components/app/analytics/hooks";
import { InsightsPanel } from "@/components/app/analytics/InsightsPanel";
import { OverviewPanel } from "@/components/app/analytics/OverviewPanel";
import { AnalyticsRangeProvider, RangeBar } from "@/components/app/analytics/range";
import { SearchPanel } from "@/components/app/analytics/SearchPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WebsitePanel } from "@/components/app/analytics/WebsitePanel";

const EASE = [0.22, 1, 0.36, 1] as const;

export function AnalyticsContent({
  tab,
  onTabChange,
}: {
  tab: AnalyticsTab;
  onTabChange: (t: AnalyticsTab) => void;
}) {
  useAnalyticsInvalidation();
  return (
    <TooltipProvider delayDuration={200}>
      <AnalyticsRangeProvider>
        <div className="mx-auto w-full max-w-6xl p-3 pb-16 sm:p-5 lg:p-6">
          <div className="sticky top-0 z-20 -mx-3 mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background/85 px-3 pb-3 pt-1 backdrop-blur-xl sm:-mx-5 sm:px-5">
            <AnalyticsTabs value={tab} onChange={onTabChange} />
            <RangeBar />
          </div>

          <AnalyticsGate>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: EASE }}
              >
                {tab === "overview" && <OverviewPanel onTabChange={onTabChange} />}
                {tab === "website" && <WebsitePanel />}
                {tab === "search" && <SearchPanel />}
                {tab === "content" && <ContentPanel />}
                {tab === "insights" && <InsightsPanel />}
              </motion.div>
            </AnimatePresence>
          </AnalyticsGate>
        </div>
      </AnalyticsRangeProvider>
    </TooltipProvider>
  );
}
