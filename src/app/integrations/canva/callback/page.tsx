import type { Metadata } from "next";
import { Suspense } from "react";
import { CanvaCallback } from "@/components/app/connectors/CanvaCallback";
export const metadata: Metadata = {
  title: "Connecting Canva · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default function Page() {
  return (
    <Suspense fallback={<main className="p-8">Connecting Canva…</main>}>
      <CanvaCallback />
    </Suspense>
  );
}
