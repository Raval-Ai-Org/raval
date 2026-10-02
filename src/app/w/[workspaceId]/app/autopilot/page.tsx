import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AutopilotRoute from "@/components/app/AutopilotRoute";

export const metadata: Metadata = pageMetadata({
  title: "Autopilot · Mellox AI",
  description:
    "Mellox plans, writes and schedules your marketing. You approve before anything goes out.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceAutopilotPage() {
  return <AutopilotRoute />;
}
