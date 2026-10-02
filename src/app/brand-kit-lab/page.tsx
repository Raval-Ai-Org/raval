import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandKitLab } from "@/components/app/brand-kit/BrandKitLab";

export const metadata: Metadata = {
  title: "Brand Kit lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Brand Kit styles: the "new style" screens and
 * the colour picker, rendered with sample data. No workspace or sign-in needed.
 * Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BrandKitLab />;
}
