import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/ui/page-loader";
import { SocialConnectCallback } from "@/components/app/SocialConnectCallback";

// OAuth return page for social account connections (SocialAPI.ai redirects
// here). Private and single-use — never indexable.
export const metadata: Metadata = {
  title: "Connecting account · Mellox AI",
  robots: "noindex,nofollow",
};

export default function SocialConnectedPage() {
  return (
    <Suspense fallback={<PageLoader label="Connecting account…" />}>
      <SocialConnectCallback />
    </Suspense>
  );
}
