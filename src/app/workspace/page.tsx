import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import AppShell from "../app/AppShell";

export const metadata: Metadata = pageMetadata({
  title: "Workspace · Mellox AI",
  description:
    "Your Marketing Intelligence Layer with Ravi for planning, creating, optimizing and growing marketing for the active brand.",
  path: "/workspace",
  noindex: true,
});

export default function Page() {
  return (
    <SessionGate>
      <AppShell />
    </SessionGate>
  );
}
