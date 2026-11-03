import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InspoLab } from "@/components/app/inspo/InspoLab";

export const metadata: Metadata = { title: "Inspo lab", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <InspoLab />;
}
