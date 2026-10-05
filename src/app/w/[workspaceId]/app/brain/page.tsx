import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import BrainRoute from "@/components/app/BrainRoute";

export const metadata: Metadata = pageMetadata({
  title: "Brain · Mellox AI",
  description:
    "Your brand, audience, competitors and market in one place, and the marketing strategy Mellox follows.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceBrainPage() {
  return <BrainRoute />;
}
