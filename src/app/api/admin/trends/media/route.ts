// Trend Radar media upload (ADR-0052): one picture or clip per request, stored
// under platform/trends/<key>/ and returned with a short signed link for the
// form's preview. The trend row saves only paths this route wrote.
import { defineAdminRoute } from "@/server/admin/route";
import { HttpError } from "@/server/http-error";
import {
  TREND_MEDIA_MAX_BYTES,
  TrendMediaError,
  signTrendMedia,
  storeTrendMedia,
} from "@/server/trends/media.server";

export const dynamic = "force-dynamic";

export const POST = defineAdminRoute({
  name: "admin.trends.media",
  permission: "trends.manage",
  write: true,
  handler: async ({ request }) => {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > TREND_MEDIA_MAX_BYTES + 1024 * 1024) {
      throw new HttpError(413, "That file is too large (50 MB at most).");
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "Send the file as a form upload.");
    }
    const file = form.get("file");
    const key = String(form.get("key") ?? "");
    const caption = typeof form.get("caption") === "string" ? String(form.get("caption")) : null;
    if (!(file instanceof File)) throw new HttpError(400, "No file was sent.");
    try {
      const media = await storeTrendMedia({ key, file, caption });
      const url = (await signTrendMedia([media.path], 3600)).get(media.path) ?? null;
      return { ...media, url };
    } catch (error) {
      if (error instanceof TrendMediaError) throw new HttpError(error.status, error.message);
      throw error;
    }
  },
});
