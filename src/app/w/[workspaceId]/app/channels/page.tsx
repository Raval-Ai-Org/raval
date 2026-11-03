import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ChannelsRoute from "@/components/app/ChannelsRoute";

export const metadata: Metadata = pageMetadata({
  title: "Channels · Mellox AI",
  description: "Your social accounts, apps, website and analytics in one place.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceChannelsPage() {
  return <ChannelsRoute />;
}
