import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CanvaLab } from "@/components/studio/CanvaLab";

export const metadata: Metadata = {
  title: "Canva lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the "Edit in Canva" control: every state of
 * its panel, in the Studio toolbar and as a Library button, with sample data.
 * No workspace, sign-in or Canva account needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CanvaLab />;
}
