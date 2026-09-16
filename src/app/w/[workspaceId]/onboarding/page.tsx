import type { Metadata } from "next";
import Onboarding from "@/app/onboarding/OnboardingPage";

export const metadata: Metadata = {
  title: "Set Up Your Workspace · Mellox AI",
  robots: "noindex,nofollow",
};

export default function WorkspaceOnboardingPage() {
  return <Onboarding />;
}
