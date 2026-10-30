import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import CampaignsRoute from "@/components/app/CampaignsRoute";

export const metadata: Metadata = pageMetadata({
  title: "Campaigns · Mellox AI",
  description: "Planned campaigns: launches, events, seasons and sales, post by post.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceCampaignsPage() {
  return <CampaignsRoute />;
}
