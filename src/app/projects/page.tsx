import type { Metadata } from "next";
import { pageMetadata, webPageLd } from "@/lib/seo";
import { SessionGate } from "@/components/auth/SessionGate";
import ProjectsPage from "./ProjectsPage";

// /projects — the all-workspaces home. Sign-in and the app root land here;
// a workspace opens only when the user picks one (/w/<id>/app).
const TITLE = "Workspaces · Mellox AI";
const DESCRIPTION = "Manage every brand workspace in one Mellox AI Marketing Intelligence Layer.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/projects",
  noindex: true,
});

const JSON_LD = webPageLd({ title: TITLE, description: DESCRIPTION, path: "/projects" });

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
