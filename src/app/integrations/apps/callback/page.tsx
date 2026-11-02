import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/ui/page-loader";
import { AppConnectCallback } from "@/components/app/connectors/AppConnectCallback";

export const metadata: Metadata = {
  title: "Connecting an app · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default function AppConnectCallbackPage() {
  return (
    <Suspense fallback={<PageLoader label="Connecting…" />}>
      <AppConnectCallback />
    </Suspense>
  );
}
