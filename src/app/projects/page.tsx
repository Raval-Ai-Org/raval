import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo";

const TITLE = "Workspaces · Mellox AI";
const DESCRIPTION =
  "Manage every client workspace in one Mellox AI Marketing Intelligence Layer.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/workspaces",
  noindex: true,
});

export default function Page() {
  redirect("/workspaces");
}
