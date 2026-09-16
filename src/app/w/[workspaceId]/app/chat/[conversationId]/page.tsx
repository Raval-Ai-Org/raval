import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Conversation · Mellox AI",
  description: "Continue a conversation with Mellox AI.",
  path: "/projects",
  noindex: true,
});

export default function WorkspaceConversationPage() {
  return null;
}
