import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { z } from "zod";
import { safeFetch } from "@/server/safe-fetch";
import { PURPOSES, FORMATS } from "@/lib/brand-visuals/contracts";
import { readReferenceForm } from "@/server/brand-visuals/multipart.server";
import {
  ingestFetchedVideo,
  ingestImage,
  problemMessage,
  type ReferenceTarget,
} from "@/server/brand-visuals/ingest.server";
import { MAX_IMAGE_BYTES, UPLOAD_MESSAGES, uploadKind, uploadType } from "@/lib/inspo/uploads";
import { isReelLink } from "@/lib/inspo/links";
import { fetchReelVideo } from "@/server/brand-visuals/link-media.server";
import { isInspoLinksEnabled } from "@/lib/feature-flags";

// A link (or one small file sent as a form). Files from Inspo go straight to
// storage through ./start and ./finish instead; both end in the same ingest.
const LINK_MAX_BYTES = 100 * 1024 * 1024;

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = defineRoute({
  name: "brand-visuals/upload",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "generate",
  query: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, workspaceId, userId, role }) => {
    const form = await readReferenceForm(request);
    const file = form.get("file");
    const purpose = String(form.get("purpose") ?? "style");
    if (!PURPOSES.includes(purpose as (typeof PURPOSES)[number]))
      return jsonError(400, "Choose what this reference is for.");
    if (file instanceof File && (!file.size || file.size > 20 * 1024 * 1024))
      return jsonError(400, "Choose an image or short video, up to 20 MB.");
    const format = String(form.get("format") ?? "all");
    if (format !== "all" && !FORMATS.includes(format as (typeof FORMATS)[number]))
      return jsonError(400, "Choose a supported format.");
    let input: Buffer;
    let mime: string;
    let external: string | undefined;
    if (file instanceof File) {
      input = Buffer.from(await file.arrayBuffer());
      mime = uploadType(file);
    } else if (isReelLink(String(form.get("sourceUrl") ?? ""))) {
      // Instagram, TikTok and YouTube pages aren't video files: read them only when allowed.
      const reel = isInspoLinksEnabled(workspaceId)
        ? await fetchReelVideo(String(form.get("sourceUrl")))
        : null;
      if (!reel) return jsonError(422, UPLOAD_MESSAGES.link);
      input = reel.bytes;
      mime = reel.mime;
      external = reel.url;
      if (!form.get("label") && reel.title) form.set("label", reel.title);
    } else {
      const url = String(form.get("sourceUrl") ?? "");
      const fetched = await safeFetch(url, { maxBytes: LINK_MAX_BYTES, onOverflow: "error" }).catch(
        () => null,
      );
      if (!fetched?.ok) return jsonError(422, UPLOAD_MESSAGES.link);
      input = Buffer.from(fetched.bytes);
      mime = (fetched.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      external = fetched.url;
    }
    const kind = uploadKind(mime);
    if (!kind) return jsonError(415, external ? UPLOAD_MESSAGES.link : UPLOAD_MESSAGES.type);
    if (kind === "image" && input.length > MAX_IMAGE_BYTES)
      return jsonError(413, UPLOAD_MESSAGES.imageSize);
    const label =
      String(form.get("label") ?? (file instanceof File ? file.name : "Inspo"))
        .trim()
        .slice(0, 100) || "Inspo";
    const target: ReferenceTarget = {
      purpose: purpose as (typeof PURPOSES)[number],
      label,
      notes: String(form.get("notes") ?? ""),
      format,
      campaign: String(form.get("campaign") ?? "").slice(0, 120) || undefined,
      sourceUrl: external,
    };
    const c = { workspaceId, userId, role };
    try {
      const { assetId } =
        kind === "video"
          ? await ingestFetchedVideo(c, input, mime, target)
          : await ingestImage(c, input, mime, target);
      return Response.json({ assetId });
    } catch (error) {
      return jsonError(422, problemMessage(error, kind));
    }
  },
});
