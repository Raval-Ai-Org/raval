import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ResetPasswordPage from "./ResetPasswordPage";

export const metadata: Metadata = pageMetadata({
  title: "Reset password · Raval AI",
  description:
    "Reset your Raval AI password to get back into the Marketing Intelligence Layer for your brand or agency.",
  path: "/reset-password",
  noindex: true,
});

export default function Page() {
  return <ResetPasswordPage />;
}
