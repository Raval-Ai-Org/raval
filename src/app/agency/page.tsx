import type { Metadata } from "next";
import { pageMetadata, webPageLd } from "@/lib/seo";
import AgencyHQ from "./AgencyPage";

const TITLE = "Command Center · Mellox AI";
const DESCRIPTION =
  "Run every client from one place: review, schedule, health and results across all your brands.";

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
