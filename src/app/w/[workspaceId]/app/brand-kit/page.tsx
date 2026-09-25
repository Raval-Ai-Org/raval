import { Suspense } from "react";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import BrandKitRoute from "@/components/app/BrandKitRoute";

export const metadata: Metadata = pageMetadata({
  title: "Brand Kit · Mellox AI",
  description: "Your styles, logos, fonts, colors and examples, used by everything Mellox creates.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceBrandKitPage() {
  return (
    <Suspense>
      <BrandKitRoute />
    </Suspense>
  );
}
