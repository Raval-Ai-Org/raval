import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import BacklinksRoute from "@/components/app/BacklinksRoute";

export const metadata: Metadata = pageMetadata({
  title: "Backlinks · Mellox AI",
  description:
    "See which websites link to your brand, what you have lost, where competitors are ahead, and who to approach next.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it rather than competing for layout.
export default function WorkspaceBacklinksPage() {
  return <BacklinksRoute />;
}
