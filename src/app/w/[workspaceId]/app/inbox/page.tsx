import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import EngageRoute from "@/components/app/EngageRoute";

export const metadata: Metadata = pageMetadata({
  title: "Inbox · Mellox AI",
  description: "Comments on your Instagram and Facebook posts, with replies you send yourself.",
  path: "/projects",
  noindex: true,
});

// AppShell (mounted by the parent layout) owns the viewport, so this route
// renders its own layered surface over it.
export default function WorkspaceInboxPage() {
  return <EngageRoute />;
}
