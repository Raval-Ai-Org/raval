import type { Metadata } from "next";
import { BASE_URL } from "@/lib/seo";
import SignupPage from "./SignupPage";

export const metadata: Metadata = {
  title: "Create Account · Mellox AI",
  description:
    "Create your Mellox AI workspace — the Marketing Intelligence Layer for brands and agencies.",
  alternates: { canonical: `${BASE_URL}/signup` },
  robots: "noindex,nofollow",
  openGraph: {
    title: "Create Account · Mellox AI",
    description:
      "Start your Mellox AI workspace and get visible inside LLMs with AEO/GEO, Brand DNA and multi-client operations.",
    url: `${BASE_URL}/signup`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Create Account · Mellox AI",
    description:
      "Start your Mellox AI workspace and get visible inside LLMs with AEO/GEO, Brand DNA and multi-client operations.",
  },
};

export default function Page() {
  return <SignupPage />;
}
