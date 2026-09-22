"use client";

import { motion } from "framer-motion";
import { FileText, Globe, LayoutDashboard, Lightbulb, Search } from "@/components/icons";
import { cn } from "@/lib/utils";

export type AnalyticsTab = "overview" | "website" | "search" | "content" | "insights";

export const TABS: {
  id: AnalyticsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, blurb: "Everything at a glance" },
  { id: "website", label: "Website", icon: Globe, blurb: "Visits to your site" },
  { id: "search", label: "Search", icon: Search, blurb: "How you show up in Google" },
  { id: "content", label: "Content", icon: FileText, blurb: "What you made and posted" },
  { id: "insights", label: "Insights", icon: Lightbulb, blurb: "What changed and what to do" },
];

/** Old ?tab= values keep working. */
const LEGACY: Record<string, AnalyticsTab> = {
  organic: "search",
  social: "content",
  audience: "website",
  geo: "overview",
  "ai-visibility": "overview",
};

export function normalizeAnalyticsTab(value: string | null | undefined): AnalyticsTab | null {
  if (!value) return null;
  if (TABS.some((t) => t.id === value)) return value as AnalyticsTab;
  return LEGACY[value] ?? null;
}

export function AnalyticsTabs({
  value,
  onChange,
  className,
}: {
  value: AnalyticsTab;
  onChange: (t: AnalyticsTab) => void;
  className?: string;
}) {
  return (
    <nav
      role="tablist"
      aria-label="Analytics sections"
      className={cn(
        "scrollbar-none flex items-center gap-0.5 overflow-x-auto rounded-full border border-border/70 bg-card/60 p-1",
        className,
      )}
    >
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
                className="absolute inset-0 -z-10 rounded-full bg-background shadow-sm ring-1 ring-border/70"
              />
            )}
            <Icon className={cn("h-3.5 w-3.5", isActive && "text-primary")} />
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
