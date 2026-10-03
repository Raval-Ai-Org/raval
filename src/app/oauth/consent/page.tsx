import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/ui/page-loader";
import { ConsentPage } from "./ConsentPage";

// Where Supabase Auth's OAuth server sends a person to agree (or not) to an AI
// assistant using Mellox as them (ADR-0029). Private and single-use.
export const metadata: Metadata = {
  title: "Connect an assistant · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading…" />}>
      <ConsentPage />
    </Suspense>
  );
}
