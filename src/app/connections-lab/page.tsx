import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectionsLab } from "@/components/app/connectors/ConnectionsLab";

export const metadata: Metadata = {
  title: "Connections lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Settings: the connection cards (apps and
 * website platforms) and the AI assistants screen, with sample data. No
 * workspace or sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ConnectionsLab />;
}
