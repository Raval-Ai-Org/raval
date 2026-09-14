import type { Metadata } from "next";
import { Suspense } from "react";
import { GitHubInstallCallback } from "@/components/app/connectors/GitHubInstallCallback";

// Return page for the GitHub App install flow. Private and single-use — never indexable.
export const metadata: Metadata = {
  title: "Connecting GitHub · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={null}>
      <GitHubInstallCallback />
    </Suspense>
  );
}
