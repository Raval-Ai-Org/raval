import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeLab } from "@/components/app/home/HomeLab";

export const metadata: Metadata = {
  title: "Home lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual check for Mellox 2.0's frame, sidebar and Home with
 * sample data. Never served in production.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { scene } = await searchParams;
  return <HomeLab scene={scene} />;
}
