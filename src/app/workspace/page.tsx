import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import { LegacyAppRedirect } from "@/components/workspace/LegacyAppRedirect";

// Pre-/w/ link: resolved to the canonical /w/<workspaceId>/app route, or to
// /projects — never to a guessed workspace (see LegacyAppRedirect).
export const metadata: Metadata = pageMetadata({
  title: "Workspace · Mellox AI",
  description:
    "Your Marketing Intelligence Layer with Mellox for planning, creating, optimizing and growing marketing for each brand workspace.",
  path: "/workspace",
  noindex: true,
});

export default function Page() {
  return (
    <SessionGate>
      <LegacyAppRedirect />
    </SessionGate>
  );
}
