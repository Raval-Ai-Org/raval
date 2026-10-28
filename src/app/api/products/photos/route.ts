// POST /api/products/photos?workspaceId=&productId= (multipart "file") — store
// a product photo (validated by its bytes) and make it the product's main
// photo. Studio keeps this exact photo when it makes a post about the product.
import { z } from "zod";
import { HttpError } from "@/server/http-error";
import { defineRoute } from "@/server/route";
import { addUploadedPhoto } from "@/server/products/service.server";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "products/photos:upload",
  auth: "workspace",
  minRole: "editor",
  query: z.object({ workspaceId: z.string().uuid(), productId: z.string().uuid() }),
  workspaceId: ({ query }) => query.workspaceId,
  rateLimit: "setup-write",
  handler: async ({ request, query, workspaceId, userId, role }) => {
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
    return addUploadedPhoto({ workspaceId, userId, role }, query.productId, file);
  },
});
