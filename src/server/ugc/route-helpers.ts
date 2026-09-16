// Small shared pieces for the /api/ugc routes.
import "server-only";
import { UUID_RE } from "@/server/api-auth";
import { HttpError } from "@/server/http-error";
import { isUgcVideoEnabled } from "@/lib/feature-flags";

/** The uuid path segment right after `segment` (e.g. "projects", "renders"). */
export function idAfter(request: Request, segment: string): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.indexOf(segment) + 1];
  if (!id || !UUID_RE.test(id)) throw new HttpError(400, "Invalid id");
  return id;
}

export function assertUgcEnabled(workspaceId: string) {
  if (!isUgcVideoEnabled(workspaceId)) {
    throw new HttpError(503, "UGC video ads aren't available on this workspace.");
  }
}
