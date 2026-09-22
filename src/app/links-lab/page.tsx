import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinksLab } from "@/components/app/links/LinksLab";

export const metadata: Metadata = {
  title: "Links lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Backlink Growth: the cards, the journey, every
 * order state and the empty screen, rendered with sample data. No workspace or
 * sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LinksLab />;
}
