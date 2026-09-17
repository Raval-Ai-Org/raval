import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatLab } from "@/components/app/chat/ChatLab";

export const metadata: Metadata = {
  title: "Chat lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the chat: greeting, message box, streaming
 * reply, offers and the Studio card with sample data. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ChatLab />;
}
