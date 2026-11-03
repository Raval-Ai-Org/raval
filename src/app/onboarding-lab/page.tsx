import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OnboardingLab } from "@/components/onboarding/OnboardingLab";

export const metadata: Metadata = {
  title: "Onboarding lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for onboarding's goal, product, channel and
 * first-post steps, with sample data (`?step=goals|manual|products|channels|
 * first|first-running|first-failed`, `&empty=1` for an empty catalogue). No
 * workspace or sign-in needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <OnboardingLab />;
}
