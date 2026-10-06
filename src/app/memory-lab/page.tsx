import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemoryLab } from "@/components/app/memory/MemoryLab";

export const metadata: Metadata = {
  title: "Memory lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Memory: the list, the empty, read-only and
 * switched-off screens, and what a chat reply carries (the "Memory updated"
 * note, prepared changes, place buttons), with sample data. No workspace or
 * sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MemoryLab />;
}
