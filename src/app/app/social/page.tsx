import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import { LegacyAppRedirect } from "@/components/workspace/LegacyAppRedirect";

// Pre-/w/ link: resolved to the canonical /w/<workspaceId>/app route, or to
// /projects — never to a guessed workspace (see LegacyAppRedirect).
export const metadata: Metadata = pageMetadata({
  title: "Social · Mellox AI",
  description:
    "Schedule and publish social content for a brand workspace with Mellox, the Mellox AI Marketing Intelligence Layer.",
  path: "/app/social",
  noindex: true,
});

export default function Page() {
  return (
    <SessionGate>
      <LegacyAppRedirect />
    </SessionGate>
  );
}
