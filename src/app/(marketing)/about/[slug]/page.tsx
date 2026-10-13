import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { FOUNDERS } from "@/marketing/lib/about";

// Retire existing profile URLs without publishing biographies or personal metadata.
const retiredSlugs = FOUNDERS.flatMap((founder) => (founder.profile ? [founder.profile.slug] : []));

export const metadata: Metadata = {
  title: "About",
  alternates: { canonical: "/about" },
  robots: { index: false, follow: true },
};

export const dynamicParams = false;

export function generateStaticParams() {
  return retiredSlugs.map((slug) => ({ slug }));
}

export default async function RetiredFounderPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!retiredSlugs.includes(slug)) notFound();
  permanentRedirect("/about");
}
