import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import CommunitiesRoute from "@/components/app/CommunitiesRoute";

export const metadata: Metadata = pageMetadata({
  title: "Communities · Mellox AI",
  description: "Threads where people ask about what you do, with replies you post yourself.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceCommunitiesPage() {
  return <CommunitiesRoute />;
}
