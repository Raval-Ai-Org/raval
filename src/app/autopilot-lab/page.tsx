import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutopilotLab } from "@/components/app/autopilot/AutopilotLab";

export const metadata: Metadata = {
  title: "Autopilot lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for Autopilot: the setup, home, approvals, ideas,
 * activity and settings screens with sample data, no workspace or sign-in
 * needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AutopilotLab />;
}
