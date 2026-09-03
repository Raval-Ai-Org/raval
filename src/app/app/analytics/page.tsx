import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { BASE_URL } from "@/lib/seo";

// Mirrors the tab ids in components/app/AnalyticsTabs. Inlined so this server
// component doesn't pull the (client-only) tab bar into the server graph.
type AnalyticsTab = "overview" | "organic" | "social" | "content" | "audience" | "automations";
const VALID = new Set<string>([
  "overview",
  "organic",
  "social",
  "content",
  "audience",
  "automations",
]);

// Private studio deep-link — must never be indexable. The redirect lands on
// /app (noindex), so pin the same noindex + canonical here in case a crawler
// or the redirect chain reads this route's shell directly.
export const metadata: Metadata = {
  title: "Analytics · Mellox AI",
  robots: "noindex,nofollow",
  alternates: { canonical: `${BASE_URL}/app` },
};

// Analytics is now an in-app modal launched from /app. Old bookmarks
// redirect to /app and carry the desired tab through the URL so it works
// for both SSR and client-only navigation (sessionStorage would be missed
// on server-side redirect).
export default async function AnalyticsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = typeof params.tab === "string" ? params.tab : undefined;
  const tab: AnalyticsTab = raw && VALID.has(raw) ? (raw as AnalyticsTab) : "overview";
  redirect(`/workspace?tab=${tab}`);
}
