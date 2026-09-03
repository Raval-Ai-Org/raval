import type { Metadata } from "next";
import { pageMetadata, webPageLd } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import ProjectsPage from "./ProjectsPage";

const TITLE = "Clients · Raval AI";
const DESCRIPTION =
  "Every client brand in one Marketing Intelligence Layer — onboard, orchestrate and grow with Brand DNA, AEO/GEO and shared operations.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/projects",
  noindex: true,
});

const JSON_LD = webPageLd({
  title: TITLE,
  description: "Every client brand in one Marketing Intelligence Layer.",
  path: "/projects",
});

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <SessionGate>
        <ProjectsPage />
      </SessionGate>
    </>
  );
}
