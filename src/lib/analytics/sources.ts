// sources.ts — the four analytics data sources. Every metric, chart and
// insight carries exactly one source; values from different sources are never
// summed, averaged or plotted on one axis (GA4 sessions ≠ Search Console
// clicks ≠ an AI Visibility score).

export const DATA_SOURCES = {
  mellox: { label: "Mellox", short: "Mellox", hint: "Content and activity inside Mellox" },
  ga4: { label: "Google Analytics 4", short: "GA4", hint: "Visits to your website" },
  gsc: {
    label: "Google Search Console",
    short: "Search Console",
    hint: "How your site shows up in Google Search",
  },
  geo: {
    label: "Mellox AI Visibility scan",
    short: "AI Visibility",
    hint: "How ready your site is for AI answers (Mellox scan score)",
  },
} as const;

export type DataSource = keyof typeof DATA_SOURCES;

export const DATA_SOURCE_IDS = Object.keys(DATA_SOURCES) as DataSource[];

export function sourceLabel(source: DataSource): string {
  return DATA_SOURCES[source].label;
}
