import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectsLab } from "./ProjectsLab";

export const metadata: Metadata = {
  title: "Projects lab",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual QA for the workspace list: the backdrop, the
 * website bar, project cards and the foot, with sample data. No sign-in
 * needed. Never served in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ProjectsLab />;
}
