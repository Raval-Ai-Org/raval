"use client";

import { motion } from "framer-motion";
import {
  FileText,
  Globe,
  LayoutDashboard,
  Lightbulb,
  Search,
  Target,
} from "@/components/icons";
import { cn } from "@/lib/utils";

export type AnalyticsTab =
  | "overview"
  | "website"
  | "search"
  | "content"
  | "ai-visibility"
  | "insights";

export const TABS: {
  id: AnalyticsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, blurb: "Every source at a glance." },
  { id: "website", label: "Website", icon: Globe, blurb: "Visits to your site · Google Analytics 4" },
  { id: "search", label: "Search", icon: Search, blurb: "Google Search results · Search Console" },
  { id: "content", label: "Content", icon: FileText, blurb: "What you make and post in Mellox" },
  { id: "ai-visibility", label: "AI Visibility", icon: Target, blurb: "Mellox scan score for AI answers" },
  { id: "insights", label: "Insights", icon: Lightbulb, blurb: "What changed and what to do next" },
];

/** Old ?tab= values keep working. */
const LEGACY: Record<string, AnalyticsTab> = {
  organic: "ai-visibility",
  social: "content",
  audience: "website",
  geo: "ai-visibility",
};

export function normalizeAnalyticsTab(value: string | null | undefined): AnalyticsTab | null {
  if (!value) return null;
  if (TABS.some((t) => t.id === value)) return value as AnalyticsTab;
  return LEGACY[value] ?? null;
}

export function AnalyticsTabs({
  value,
  onChange,
}: {
  value: AnalyticsTab;
  onChange: (t: AnalyticsTab) => void;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-3 border-b border-border/70 bg-background/85 px-3 pb-2.5 pt-2 backdrop-blur-xl sm:-mx-5 sm:px-5">
      <nav role="tablist" aria-label="Analytics sections" className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const isActive = value === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.id)}
              title={t.blurb}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="analytics-tab"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm ring-1 ring-border/80"
                />
              )}
              <Icon className={cn("h-3.5 w-3.5", isActive && "text-primary")} />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
