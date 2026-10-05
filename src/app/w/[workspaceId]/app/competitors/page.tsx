import { redirect } from "next/navigation";
import { brainPath, isWorkspaceId } from "@/lib/workspace/paths";

// Competitors lives in Brain now (ADR-0032); old links land on its section.
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(isWorkspaceId(workspaceId) ? brainPath(workspaceId, "competitors") : "/projects");
}
