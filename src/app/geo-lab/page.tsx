import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GeoLab } from "@/components/app/geo/GeoLab";

export const metadata: Metadata = {
  title: "AI Visibility lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for AI Visibility's speed card and the "since
 * your fixes went live" card, with sample data. No workspace or sign-in
 * needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GeoLab />;
}
