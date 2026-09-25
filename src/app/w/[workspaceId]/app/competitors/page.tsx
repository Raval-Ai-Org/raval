import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import CompetitorsRoute from "@/components/app/CompetitorsRoute";

export const metadata: Metadata = pageMetadata({
  title: "Brand DNA · Mellox AI",
  description: "Competitor research is part of Brand DNA.",
  path: "/projects",
  noindex: true,
});

// Older competitor links land in Brand DNA's competitor section.
export default function WorkspaceCompetitorsPage() {
  return <CompetitorsRoute />;
}
