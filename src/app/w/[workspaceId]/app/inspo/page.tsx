import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import InspoRoute from "@/components/app/InspoRoute";

export const metadata: Metadata = pageMetadata({
  title: "Inspo · Mellox AI",
  description: "How your posts look and sound, and the photos Mellox uses.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceInspoPage() {
  return <InspoRoute />;
}
