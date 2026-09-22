import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import CompetitorsRoute from "@/components/app/CompetitorsRoute";

export const metadata: Metadata = pageMetadata({
  title: "Competitors · Mellox AI",
  description:
    "See who you're competing with, what they sell, and what changed on their side recently.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it rather than competing for layout.
export default function WorkspaceCompetitorsPage() {
  return <CompetitorsRoute />;
}
