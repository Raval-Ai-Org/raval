import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import { LibraryPage } from "@/components/app/LibraryPage";

export const metadata: Metadata = pageMetadata({
  title: "Library · Mellox AI",
  description: "Asset library for the active workspace — generated media, uploads, files and brand assets.",
  path: "/app/library",
  noindex: true,
});

export default function LibraryRoute() {
  return (
    <SessionGate>
      <LibraryPage />
    </SessionGate>
  );
}
