import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/ui/page-loader";
import { WebflowConnectCallback } from "@/components/app/connectors/WebflowConnectCallback";

export const metadata: Metadata = {
  title: "Connecting Webflow · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default function WebflowCallbackPage() {
  return (
    <Suspense fallback={<PageLoader label="Connecting Webflow…" />}>
      <WebflowConnectCallback />
    </Suspense>
  );
}
