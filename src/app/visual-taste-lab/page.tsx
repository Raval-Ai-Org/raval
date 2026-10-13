import { notFound } from "next/navigation";
import { VisualTasteLab } from "@/components/app/brain/brand/look/VisualTasteLab";
export const metadata = { title: "Visual taste lab", robots: { index: false, follow: false } };
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <VisualTasteLab />;
}
