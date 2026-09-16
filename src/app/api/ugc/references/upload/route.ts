// POST /api/ugc/references/upload?workspaceId= (multipart "file") — store a
// product photo (validated by its bytes) for use as a video reference image.
import { WorkspaceQuery } from "@/lib/ugc/schemas";
import { HttpError } from "@/server/http-error";
import { defineRoute } from "@/server/route";
import { storeUploadedReference } from "@/server/ugc/references.server";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "ugc/references:upload",
  auth: "workspace",
  minRole: "editor",
  query: WorkspaceQuery,
  workspaceId: ({ query }) => query.workspaceId,
  rateLimit: "ugc-draft",
  handler: async ({ request, workspaceId }) => {
    assertUgcEnabled(workspaceId);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 11 * 1024 * 1024) throw new HttpError(413, "Images must be 10 MB or smaller.");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "Send the image as multipart form data.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No image was attached.");
    return { reference: await storeUploadedReference(workspaceId, file) };
  },
});
