import type { Metadata } from "next";
import { SessionGate } from "@/components/auth/SessionGate";
import StartPage from "./StartPage";

// /start?url=<site> — a website typed on the public site, after sign-in:
// make (or reopen) its workspace and go straight to the Brand DNA scan.
export const metadata: Metadata = {
  title: "Setting Up Your Brand · Mellox AI",
  robots: "noindex,nofollow",
};

export default function Page() {
  return (
    <SessionGate>
      <StartPage />
    </SessionGate>
  );
}
