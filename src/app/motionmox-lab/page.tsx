import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionMoxLab } from "@/components/studio/motionmox/MotionMoxLab";

export const metadata: Metadata = {
  title: "MotionMox lab",
  robots: { index: false, follow: false },
};

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MotionMoxLab />;
}
