import type { Metadata } from "next";
import { BASE_URL } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import Onboarding from "./OnboardingPage";

export const metadata: Metadata = {
  title: "Set Up Your Workspace · Mellox AI",
  description:
    "Set up your Mellox AI workspace and let Ravi build its Brand DNA, AEO/GEO baseline and first week of content.",
  alternates: { canonical: `${BASE_URL}/onboarding` },
  robots: "noindex,nofollow",
  openGraph: {
    title: "Set Up Your Workspace · Mellox AI",
    description:
      "Add a new brand to your Mellox AI workspace and let Ravi build its Brand DNA, AEO/GEO baseline and first week of content.",
    url: `${BASE_URL}/onboarding`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Set Up Your Workspace · Mellox AI",
    description:
      "Add a new brand to your Mellox AI workspace and let Ravi build its Brand DNA, AEO/GEO baseline and first week of content.",
  },
};

export default function Page() {
  return (
    <SessionGate>
      <Onboarding />
    </SessionGate>
  );
}
