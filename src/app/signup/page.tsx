import type { Metadata } from "next";
import { BASE_URL } from "@/lib/seo";
import SignupPage from "./SignupPage";

export const metadata: Metadata = {
  title: "Create account · Raval AI",
  description:
    "Create your Raval AI workspace — the Marketing Intelligence Layer for brands and agencies.",
  alternates: { canonical: `${BASE_URL}/signup` },
  robots: "noindex,nofollow",
  openGraph: {
    title: "Create account · Raval AI",
    description:
      "Start your Raval AI workspace and get visible inside LLMs with AEO/GEO, Brand DNA and multi-client operations.",
    url: `${BASE_URL}/signup`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Create account · Raval AI",
    description:
      "Start your Raval AI workspace and get visible inside LLMs with AEO/GEO, Brand DNA and multi-client operations.",
  },
};

export default function Page() {
  return <SignupPage />;
}
