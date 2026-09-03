import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import AppShell from "./AppShell";

export const metadata: Metadata = pageMetadata({
  title: "Workspace · Mellox AI",
  description:
    "Your Marketing Intelligence Layer — chat with Ravi to plan, create, optimize and grow content, SEO/AEO/GEO and social for the active brand.",
  path: "/app",
  noindex: true,
});

export default function Page() {
  return (
    <SessionGate>
      <AppShell />
    </SessionGate>
  );
}
