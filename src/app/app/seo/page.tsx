import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import { LegacyAppRedirect } from "@/components/workspace/LegacyAppRedirect";

// Pre-/w/ link: resolved to the canonical /w/<workspaceId>/app route, or to
// /projects — never to a guessed workspace (see LegacyAppRedirect).
export const metadata: Metadata = pageMetadata({
  title: "AI Visibility · Mellox AI",
  description:
    "SEO, AEO and GEO visibility for a brand workspace with Ravi, the Mellox AI Marketing Intelligence Layer.",
  path: "/app/seo",
  noindex: true,
});

export default function Page() {
  return (
    <SessionGate>
      <LegacyAppRedirect />
    </SessionGate>
  );
}
