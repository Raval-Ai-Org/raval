import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Workspace · Mellox AI",
  description:
    "Your Marketing Intelligence Layer — chat with Mellox to plan, create, optimize and grow content, SEO/AEO/GEO and social for this brand.",
  path: "/projects",
  noindex: true,
});

export default function WorkspaceAppPage() {
  return null;
}
