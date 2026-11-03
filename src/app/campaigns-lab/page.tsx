import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignsLab } from "@/components/app/campaigns/CampaignsLab";

export const metadata: Metadata = {
  title: "Campaigns lab",
  robots: { index: false, follow: false },
};

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CampaignsLab />;
}
