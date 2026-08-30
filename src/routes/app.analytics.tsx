import { createFileRoute, redirect } from "@tanstack/react-router";
import { TABS, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { BASE_URL } from "@/lib/seo";

const VALID = new Set(TABS.map((t) => t.id));

export const Route = createFileRoute("/app/analytics")({
  // Private studio deep-link — must never be indexable. The redirect lands on
  // /app (noindex), so pin the same noindex + canonical here in case a crawler
  // or the redirect chain reads this route's shell directly.
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow" }],
    links: [{ rel: "canonical", href: `${BASE_URL}/app` }],
  }),
  validateSearch: (s: Record<string, unknown>): { tab: AnalyticsTab } => {
    const t =
      typeof s.tab === "string" && VALID.has(s.tab as AnalyticsTab)
        ? (s.tab as AnalyticsTab)
        : "overview";
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
