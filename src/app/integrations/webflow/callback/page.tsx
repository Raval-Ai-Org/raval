import type { Metadata } from "next";
import { Suspense } from "react";
import { WebflowConnectCallback } from "@/components/app/connectors/WebflowConnectCallback";

export const metadata: Metadata = {
  title: "Connecting Webflow · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default function WebflowCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-background p-4 text-sm text-muted-foreground">
          Connecting Webflow…
        </main>
      }
    >
      <WebflowConnectCallback />
    </Suspense>
  );
}
