import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrainLab } from "@/components/app/brain/BrainLab";

export const metadata: Metadata = {
  title: "Brain lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Brain: Home, Strategy, the Coach pill and the
 * Look & voice editor with sample data, no workspace or sign-in needed. Never
 * served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BrainLab />;
}
