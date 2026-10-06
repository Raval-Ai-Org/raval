import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UpgradeLab } from "@/components/app/billing/UpgradeLab";

export const metadata: Metadata = {
  title: "Upgrade lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the upgrade window: plans, a locked feature,
 * a reached limit, credit packs, a teammate who can't buy, and the request
 * steps, with sample data. No workspace or sign-in needed. Never served in
 * production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UpgradeLab />;
}
