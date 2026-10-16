import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminLab } from "@/components/admin/console/AdminLab";

export const metadata: Metadata = {
  title: "Admin lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the admin console: the real screens in the
 * real shell, answered by sample data, for any role. No sign-in or database
 * needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <AdminLab />
    </Suspense>
  );
}
