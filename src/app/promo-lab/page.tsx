import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PromoLab } from "@/components/promo/PromoLab";
import { PRODUCTION_URL } from "@/marketing/lib/seo";

export const metadata: Metadata = {
  title: "Promo lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only player for the 40-second product film, drawn with sample
 * data. `?record=1` hides the controls so `scripts/record-promo.mjs` can save
 * it frame by frame. No workspace or sign-in needed. Never served in production.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ record?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { record } = await searchParams;
  return <PromoLab record={record === "1"} site={new URL(PRODUCTION_URL).host} />;
}
