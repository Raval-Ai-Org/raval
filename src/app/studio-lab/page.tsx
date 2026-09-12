import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudioLab } from "@/components/studio/StudioLab";

export const metadata: Metadata = {
  title: "Studio lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Studio: every step and format rendered with
 * sample data, no workspace or sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <StudioLab />;
}
