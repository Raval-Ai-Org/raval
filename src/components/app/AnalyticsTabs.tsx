"use client";

import {
  FileText,
  Globe,
  Heart,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  Search,
} from "@/components/icons";

export type AnalyticsTab =
  "overview" | "social" | "ads" | "website" | "search" | "content" | "insights";

export const TABS: {
  id: AnalyticsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, blurb: "Everything at a glance" },
  { id: "social", label: "Social", icon: Heart, blurb: "How your posts do" },
  { id: "ads", label: "Ads & leads", icon: Megaphone, blurb: "Google Ads and HubSpot" },
  { id: "website", label: "Website", icon: Globe, blurb: "Visits to your site" },
  { id: "search", label: "Search", icon: Search, blurb: "How you show up in Google" },
  { id: "content", label: "Content", icon: FileText, blurb: "What you made and posted" },
  { id: "insights", label: "Insights", icon: Lightbulb, blurb: "What changed and what to do" },
];

/** Old ?tab= values keep working. */
const LEGACY: Record<string, AnalyticsTab> = {
  organic: "search",
  audience: "website",
  geo: "overview",
  "ai-visibility": "overview",
};

export function normalizeAnalyticsTab(value: string | null | undefined): AnalyticsTab | null {
  if (!value) return null;
  if (TABS.some((t) => t.id === value)) return value as AnalyticsTab;
  return LEGACY[value] ?? null;
}
