import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppShell from "@/app/app/AppShell";
import { SessionGate } from "@/components/auth/SessionGate";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

export const metadata: Metadata = {
  title: "Workspace UI lab",
  robots: { index: false, follow: false },
};

/** Real workspace UI for network-fixture tests; unavailable in production. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <SessionGate>
      <WorkspaceProvider workspaceId="00000000-0000-4000-8000-000000000001">
        <AppShell />
      </WorkspaceProvider>
    </SessionGate>
  );
}
