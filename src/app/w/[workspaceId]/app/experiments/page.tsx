import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ExperimentsRoute from "@/components/app/ExperimentsRoute";

export const metadata: Metadata = pageMetadata({
  title: "Experiments · Mellox AI",
  description: "Test a change on half of similar pages and see whether it really helped.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceExperimentsPage() {
  return <ExperimentsRoute />;
}
