import type { Metadata } from "next";
import { SessionGate } from "@/components/auth/SessionGate";
import { BillingAdmin } from "@/components/admin/BillingAdmin";

// /admin — Mellox staff console for plans, requests and balances. Every API
// behind it checks BILLING_ADMIN_USER_IDS on the server; this page only
// renders what those APIs allow.
export const metadata: Metadata = {
  title: "Admin · Mellox AI",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <SessionGate>
      <BillingAdmin />
    </SessionGate>
  );
}
