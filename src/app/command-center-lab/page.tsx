import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CommandCenter } from "@/components/app/command-center/CommandCenter";

export const metadata: Metadata = {
  title: "Command Center UI lab",
  robots: { index: false, follow: false },
};

/** The production component with browser network fixtures; never served in production. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <CommandCenter />
    </Suspense>
  );
}
