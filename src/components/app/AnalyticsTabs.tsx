"use client";

import { FileText, Globe, LayoutDashboard, Lightbulb, Search } from "@/components/icons";

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
