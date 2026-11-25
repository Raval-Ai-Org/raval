import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EngageLab } from "@/components/app/engage/EngageLab";

export const metadata: Metadata = {
  title: "Inbox lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the Inbox with sample data: the dashboard,
 * `?scene=quick-reply` (the quick reply form) and `?scene=empty`.
 * No workspace or sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <EngageLab />
    </Suspense>
  );
}
