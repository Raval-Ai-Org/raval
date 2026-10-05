import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AudienceLab } from "@/components/app/audience/AudienceLab";

export const metadata: Metadata = {
  title: "Audience lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Audience: the groups, empty, building and
 * read-only screens, plus a check and a comparison as the editor shows them,
 * with sample data. No workspace or sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AudienceLab />;
}
