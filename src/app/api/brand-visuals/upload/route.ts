import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { z } from "zod";
import { safeFetch } from "@/server/safe-fetch";
import { sampleVideoFrames } from "@/server/brand-visuals/video-frames.server";
import { persistAsset } from "@/server/assets/persist.server";
import { addVisualSource } from "@/server/brand-visuals/service.server";
import { PURPOSES, FORMATS } from "@/lib/brand-visuals/contracts";
import sharp from "sharp";
import { readReferenceForm } from "@/server/brand-visuals/multipart.server";
import { createVisualPreview } from "@/server/brand-visuals/preview.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
    const label =
      String(form.get("label") ?? (file instanceof File ? file.name : "Image reference"))
        .trim()
        .slice(0, 100) || "Reference";
    const notes = String(form.get("notes") ?? "").slice(0, 600);
    const format = String(form.get("format") ?? "all");
    if (format !== "all" && !FORMATS.includes(format as (typeof FORMATS)[number]))
      return jsonError(400, "Choose a supported format.");
    try {
      let input: Buffer;
      let mime: string;
      let external: string | undefined;
      if (file instanceof File) {
        input = Buffer.from(await file.arrayBuffer());
        mime = file.type;
      } else {
        const url = String(form.get("sourceUrl") ?? "");
        const fetched = await safeFetch(url, { maxBytes: 10 * 1024 * 1024, onOverflow: "error" });
        if (!fetched.ok) return jsonError(422, "This public image link could not be opened.");
        input = Buffer.from(fetched.bytes);
        mime = (fetched.headers.get("content-type") ?? "").split(";")[0];
        external = fetched.url;
      }
      const video = /^video\/(mp4|webm)$/.test(mime);
      if (!video && !/^image\/(png|jpeg|webp)$/.test(mime))
        return jsonError(
          415,
          "Use a direct image link, or upload a PNG, JPEG, WebP, MP4 or WebM file.",
        );
      const sampled = video ? await sampleVideoFrames(input, mime) : null;
      const bytes = video
        ? input
        : await sharp(input, { limitInputPixels: 30_000_000 })
            .rotate()
            .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
            .png()
            .toBuffer();
      const saved = await persistAsset({
        workspaceId,
        idempotencyKey: `visual-upload:${crypto.randomUUID()}`,
        bytes,
        preserveBytes: true,
        assetType: video ? "video" : "image",
        mimeType: video ? mime : "image/png",
        filename: label,
        metadata: {
          source: "visual_reference",
          purpose,
          source_url: external,
          duration: sampled?.duration,
        },
      });
      if (!saved.ok) return jsonError(saved.status, saved.message);
      if (!video) await createVisualPreview(workspaceId, saved.asset, bytes);
      const c = { workspaceId, userId, role };
      const sourcePurpose = purpose as (typeof PURPOSES)[number];
      const campaign = String(form.get("campaign") ?? "").slice(0, 120) || undefined;
      await addVisualSource(c, {
        assetId: saved.asset.id,
        label,
        purpose: sourcePurpose,
        notes,
        formats: format !== "all" ? [format] : video ? ["video", "ugc"] : [],
        campaign,
        kind: "upload",
        sourceUrl: external,
      });
      for (const [index, frame] of (sampled?.frames ?? []).entries()) {
        const asset = await persistAsset({
          workspaceId,
          idempotencyKey: `visual-frame:${saved.asset.id}:${index}`,
          bytes: frame.bytes,
          preserveBytes: true,
          assetType: "image",
          mimeType: "image/png",
          filename: `${label}-${index + 1}`,
          parentAssetId: saved.asset.id,
          metadata: { source: "visual_video_frame", time: frame.time, duration: sampled!.duration },
        });
        if (!asset.ok) throw new Error("The video reference frames could not be saved.");
        await createVisualPreview(workspaceId, asset.asset, frame.bytes);
        await addVisualSource(c, {
          assetId: asset.asset.id,
          label: `${label} · ${frame.time.toFixed(1)}s`,
          purpose: sourcePurpose,
          notes,
          formats: format !== "all" ? [format] : ["video", "ugc"],
          campaign,
          kind: "upload",
        });
      }
      return Response.json({ assetId: saved.asset.id });
    } catch {
      return jsonError(422, "This reference could not be read. Try another file.");
    }
  },
});
