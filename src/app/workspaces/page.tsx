import type { Metadata } from "next";
import { pageMetadata, webPageLd } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import ProjectsPage from "../projects/ProjectsPage";

const TITLE = "Workspaces · Mellox AI";
const DESCRIPTION =
  "Manage every client workspace in one Mellox AI Marketing Intelligence Layer.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/workspaces",
  noindex: true,
});

const JSON_LD = webPageLd({ title: TITLE, description: DESCRIPTION, path: "/workspaces" });

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