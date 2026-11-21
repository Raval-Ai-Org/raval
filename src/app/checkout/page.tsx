import { Suspense } from "react";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";

// /checkout — Plan → Payment → Launch, full screen and outside the app canvas.
// Every Upgrade, Plans and Buy press lands here (`checkoutHref`).
export const metadata: Metadata = pageMetadata({
  title: "Checkout · Mellox AI",
  description: "Choose your Mellox plan and pay securely.",
  path: "/checkout",
  noindex: true,
});

export default function Page() {
  return (
    <SessionGate>
      <Suspense fallback={null}>
        <CheckoutFlow />
      </Suspense>
    </SessionGate>
  );
}
