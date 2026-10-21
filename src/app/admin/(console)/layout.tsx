import type { Metadata } from "next";
import { SessionGate } from "@/components/auth/SessionGate";
import { AdminShell } from "@/components/admin/console/AdminShell";

// The Mellox staff console. The page only renders what /api/admin/* allows;
// every one of those routes checks the admin's permission on the server.
export const metadata: Metadata = {
  title: "Admin · Mellox AI",
  robots: { index: false, follow: false },
};

export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <AdminShell>{children}</AdminShell>
    </SessionGate>
  );
}
