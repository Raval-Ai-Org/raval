import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/ui/page-loader";
import { WordPressConnectCallback } from "@/components/app/connectors/WordPressConnectCallback";

export const metadata: Metadata = {
  title: "Connecting WordPress · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};

export default function WordPressCallbackPage() {
  return (
    <Suspense fallback={<PageLoader label="Connecting WordPress…" />}>
      <WordPressConnectCallback />
    </Suspense>
  );
}
