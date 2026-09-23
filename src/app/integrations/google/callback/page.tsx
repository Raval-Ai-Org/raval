import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/ui/page-loader";
import { GoogleConnectCallback } from "@/components/app/analytics/GoogleConnectCallback";

// Return page for the Google Analytics / Search Console connection. Private and single-use — never indexable.
export const metadata: Metadata = {
  title: "Connecting Google · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={<PageLoader label="Connecting Google…" />}>
      <GoogleConnectCallback />
    </Suspense>
  );
}
