import type { Metadata } from "next";
import { Suspense } from "react";
import { GoogleConnectCallback } from "@/components/app/analytics/GoogleConnectCallback";

// Return page for the Google Analytics / Search Console connection. Private and single-use — never indexable.
export const metadata: Metadata = {
  title: "Connecting Google · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};

export default function GoogleCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-background p-4 text-sm text-muted-foreground">
          Connecting Google…
        </main>
      }
    >
      <GoogleConnectCallback />
    </Suspense>
  );
}
