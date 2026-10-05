import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AudienceRoute from "@/components/app/AudienceRoute";

export const metadata: Metadata = pageMetadata({
  title: "Audience · Mellox AI",
  description:
    "Who your content is for, how they are likely to react before you post, and what really happened.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceAudiencePage() {
  return <AudienceRoute />;
}
