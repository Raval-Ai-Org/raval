import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/ui/page-loader";
import { WixConnectCallback } from "@/components/app/connectors/WixConnectCallback";

export const metadata: Metadata = {
  title: "Connecting Wix · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default function WixCallbackPage() {
  return (
    <Suspense fallback={<PageLoader label="Connecting Wix…" />}>
      <WixConnectCallback />
    </Suspense>
  );
}
