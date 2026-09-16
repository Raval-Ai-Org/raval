// Stored generated assets live at workspace/<workspaceId>/assets/... in the
// generated-assets bucket (storage RLS enforces the prefix for browsers).
// Server paths that read storage with the service role must enforce it too:
// a content item's meta is user-editable, so a path is only trusted when it
// belongs to the item's own workspace.

export function workspaceStoragePrefix(workspaceId: string): string {
  return `workspace/${workspaceId}/assets/`;
}

export function isWorkspaceStoragePath(path: unknown, workspaceId: string | null | undefined) {
  if (typeof path !== "string" || !workspaceId) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("//")) return false;
  return path.startsWith(workspaceStoragePrefix(workspaceId));
}
