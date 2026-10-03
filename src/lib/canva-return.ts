import { workspacePath } from "@/lib/workspace/paths";
export function safeCanvaReturn(workspaceId: string, path: string | null) {
  const prefix = `/w/${workspaceId}/app`;
  if (
    path &&
    (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) &&
    !path.includes("\\") &&
    !path.startsWith("//")
  )
    return path;
  return workspacePath(workspaceId, "", { tab: "studio" });
}
