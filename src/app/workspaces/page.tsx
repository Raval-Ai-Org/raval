import { redirect } from "next/navigation";

/** /projects is the canonical all-workspaces home. */
export default function WorkspacesRedirect(): never {
  redirect("/projects");
}
