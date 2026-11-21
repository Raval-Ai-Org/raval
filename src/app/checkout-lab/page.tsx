import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutLab } from "@/components/checkout/CheckoutLab";

export const metadata: Metadata = {
  title: "Checkout lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for /checkout with sample data:
 * ?scene=plans|feature|credits|member|unavailable|pay|launch. No Stripe calls.
 * Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <CheckoutLab />
    </Suspense>
  );
}
