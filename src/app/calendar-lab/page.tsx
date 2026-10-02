import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarLab } from "@/components/app/calendar/CalendarLab";

export const metadata: Metadata = {
  title: "Calendar lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the Content Calendar: the real component over
 * sample posts held in memory, no workspace or sign-in needed. Never served in
 * production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CalendarLab />;
}
