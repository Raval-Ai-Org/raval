import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { BASE_URL } from "@/lib/seo";

// Private studio deep-link — must never be indexable. The redirect lands on
// /app (noindex), so pin the same noindex + canonical here in case a crawler
// or the redirect chain reads this route's shell directly.
export const metadata: Metadata = {
  robots: "noindex,nofollow",
  alternates: { canonical: `${BASE_URL}/app` },
};

export default function SocialRedirect(): never {
  redirect("/app/analytics?tab=social");
}
