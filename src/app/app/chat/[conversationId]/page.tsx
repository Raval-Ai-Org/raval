import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import AppShell from "../../AppShell";

export const metadata: Metadata = pageMetadata({
  title: "Conversation · Mellox AI",
  description: "Continue a conversation with Mellox AI.",
  path: "/app/chat",
  noindex: true,
});

export default function ConversationPage() {
  return (
    <SessionGate>
      <AppShell />
    </SessionGate>
  );
}
