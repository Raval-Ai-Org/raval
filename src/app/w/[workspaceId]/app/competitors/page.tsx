import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import CompetitorsRoute from "@/components/app/CompetitorsRoute";

export const metadata: Metadata = pageMetadata({
  title: "Competitors · Mellox AI",
  description: "Research competitors and track their latest updates.",
  path: "/projects",
  noindex: true,
});

export default function WorkspaceCompetitorsPage() {
  return <CompetitorsRoute />;
}
