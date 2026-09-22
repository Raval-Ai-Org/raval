import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalyticsLab } from "@/components/app/analytics/AnalyticsLab";

export const metadata: Metadata = {
  title: "Analytics lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Analytics: the lock, the five tabs and every
 * panel, rendered with sample data. No workspace, sign-in or Google connection
 * needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AnalyticsLab />;
}
