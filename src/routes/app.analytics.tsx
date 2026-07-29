import { createFileRoute, redirect } from "@tanstack/react-router";
import { TABS, type AnalyticsTab } from "@/components/app/AnalyticsTabs";

const VALID = new Set(TABS.map((t) => t.id));

export const Route = createFileRoute("/app/analytics")({
  validateSearch: (s: Record<string, unknown>): { tab: AnalyticsTab } => {
    const t = typeof s.tab === "string" && VALID.has(s.tab as AnalyticsTab) ? (s.tab as AnalyticsTab) : "overview";
    return { tab: t };
  },
  // Analytics is now an in-app modal launched from /app. Old bookmarks
  // redirect to /app and carry the desired tab through the URL so it works
  // for both SSR and client-only navigation (sessionStorage would be missed
  // on server-side redirect).
  beforeLoad: ({ search }) => {
    const tab = (search as any)?.tab ?? "overview";
    throw redirect({ to: "/app", search: { tab } as any });
  },
});

