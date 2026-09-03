import type { Metadata } from "next";
import { BASE_URL } from "@/lib/seo";
import LoginPage from "./LoginPage";

export const metadata: Metadata = {
  title: "Sign In · Mellox AI",
  description: "Sign in to Mellox AI — the Marketing Intelligence Layer for brands and agencies.",
  alternates: { canonical: `${BASE_URL}/login` },
  robots: "noindex,nofollow",
  openGraph: {
    title: "Sign In · Mellox AI",
    description:
      "Access your Mellox AI workspace to plan, create and optimize marketing that gets you visible inside LLMs.",
    url: `${BASE_URL}/login`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sign In · Mellox AI",
    description:
      "Access your Mellox AI workspace to plan, create and optimize marketing that gets you visible inside LLMs.",
  },
};

export default function Page() {
  return <LoginPage />;
}
