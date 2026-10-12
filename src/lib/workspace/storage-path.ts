// Workspace asset keys share this prefix across Supabase Storage and R2.
// Browser access to either backend must be scoped to the verified workspace;
// user-editable content metadata is trusted only when its key has this prefix.

export function workspaceStoragePrefix(workspaceId: string): string {
  return `workspace/${workspaceId}/assets/`;
}

export function isWorkspaceStoragePath(path: unknown, workspaceId: string | null | undefined) {
  if (typeof path !== "string" || !workspaceId) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("//")) return false;
  return path.startsWith(workspaceStoragePrefix(workspaceId));
}
