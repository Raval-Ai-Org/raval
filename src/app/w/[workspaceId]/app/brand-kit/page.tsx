import { redirect } from "next/navigation";
import { brainPath, isWorkspaceId } from "@/lib/workspace/paths";

// Brand Kit and Styles are gone (ADR-0032): a brand has one look, set in
// Brain → Brand → Look & voice. Old links land there.
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(isWorkspaceId(workspaceId) ? brainPath(workspaceId, "brand", "look") : "/projects");
}
