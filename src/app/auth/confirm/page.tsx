import type { Metadata } from "next";
import EmailConfirmPage from "./EmailConfirmPage";

export const metadata: Metadata = {
  title: "Confirm your email · Mellox AI",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return <EmailConfirmPage />;
}
