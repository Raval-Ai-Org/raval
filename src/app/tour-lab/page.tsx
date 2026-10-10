import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TourLab } from "@/components/app/tour/TourLab";

export const metadata: Metadata = {
  title: "Tour lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the app tour: the welcome, every stop lit on
 * a stand-in app shell, and the last card, with sample data. No workspace or
 * sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TourLab />;
}
