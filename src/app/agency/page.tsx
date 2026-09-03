import type { Metadata } from "next";
import { pageMetadata, webPageLd } from "@/lib/seo";
import AgencyHQ from "./AgencyPage";

const TITLE = "Agency · Mellox AI";
const DESCRIPTION =
  "Manage all clients at once. Approvals, schedules, activity and combined analytics — one Marketing Intelligence Layer across every brand.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/agency",
  noindex: true,
});

const JSON_LD = webPageLd({
  title: TITLE,
  description: "Manage every client brand in one Marketing Intelligence Layer.",
  path: "/agency",
});

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <AgencyHQ />
    </>
  );
}
