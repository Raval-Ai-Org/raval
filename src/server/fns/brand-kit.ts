// brand-kit.ts — RPC for the Brand Kit and Styles.
//
// Reads use the caller's RLS-bound client. Writes check the workspace role
// (editor+) first and then use the service role inside src/server/brand-kit/.
// Anything that spends (analysis, "describe a style") has its own rate-limit
// tier and goes through the metered Anthropic gateway.
import "server-only";
import { z } from "zod";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { roleAtLeast } from "@/server/api-auth";
import { KIT_ASSET_KINDS, STYLE_FORMATS, parseStyleSpec } from "@/lib/brand-kit/spec";
import {
  styleOptionFrom,
  type BrandKitOverview,
  type BrandStyleView,
  type StyleOption,
  type UploadTicket,
} from "@/lib/brand-kit/contracts";
import type { Suggestion } from "@/lib/brand-kit/merge";

export type {
  BrandKitOverview,
  BrandStyleView,
  KitAssetView,
  StyleOption,
  UploadTicket,
} from "@/lib/brand-kit/contracts";

const uuid = z.string().uuid();
const formats = z.array(z.enum(STYLE_FORMATS)).max(STYLE_FORMATS.length);
const specInput = z.record(z.string(), z.unknown());
const fileKinds = KIT_ASSET_KINDS.filter((k) => k !== "writing_sample") as [
  Exclude<(typeof KIT_ASSET_KINDS)[number], "writing_sample">,
  ...Exclude<(typeof KIT_ASSET_KINDS)[number], "writing_sample">[],
];

const store = () => import("@/server/brand-kit/store.server");

export const getBrandKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, includeArchived: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<BrandKitOverview> => {
    const role = await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const canEdit = roleAtLeast(role, "editor");
    const s = await store();
    if (canEdit) await s.ensureSeedStyle(data.workspaceId, context.userId).catch(() => false);
    return s.loadOverview(context.supabase, data.workspaceId, {
      canEdit,
      includeArchived: data.includeArchived,
    });
  });

/** Compact list for the style pickers in Studio, chat, UGC and the calendar. */
export const listStyleOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ options: StyleOption[]; defaultStyleId: string | null }> => {
      const role = await requireWorkspaceRole(context, data.workspaceId, "viewer");
      const s = await store();
      if (roleAtLeast(role, "editor"))
        await s.ensureSeedStyle(data.workspaceId, context.userId).catch(() => false);
      const overview = await s.loadOverview(context.supabase, data.workspaceId, { canEdit: false });
      return {
        options: overview.styles.map((v) => styleOptionFrom(v, overview.dna)),
        defaultStyleId: overview.defaultStyleId,
      };
    },
  );

export const createStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        name: z.string().trim().min(1).max(80),
        description: z.string().max(400).nullish(),
        appliesTo: formats.optional(),
        spec: specInput.optional(),
        makeDefault: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<BrandStyleView> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const s = await store();
    return s.createStyle({
      workspaceId: data.workspaceId,
      userId: context.userId,
      name: data.name,
      description: data.description,
      appliesTo: data.appliesTo,
      spec: data.spec ? parseStyleSpec(data.spec) : undefined,
      makeDefault: data.makeDefault,
      status: "ready",
    });
  });

export const updateStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        styleId: uuid,
        expectedVersion: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().max(400).nullish(),
        appliesTo: formats.optional(),
        spec: specInput.optional(),
        coverAssetId: uuid.nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<BrandStyleView> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const s = await store();
    return s.updateStyle({
      workspaceId: data.workspaceId,
      userId: context.userId,
      styleId: data.styleId,
      expectedVersion: data.expectedVersion,
      patch: {
        name: data.name,
        description: data.description,
        appliesTo: data.appliesTo,
        spec: data.spec ? parseStyleSpec(data.spec) : undefined,
        coverAssetId: data.coverAssetId,
      },
    });
  });

export const duplicateStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, styleId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<BrandStyleView> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    return (await store()).duplicateStyle(data.workspaceId, context.userId, data.styleId);
  });

export const archiveStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, styleId: uuid, archived: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    await (await store()).archiveStyle(data.workspaceId, data.styleId, data.archived);
    return { ok: true };
  });

export const setDefaultStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, styleId: uuid.nullable() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    await (await store()).setDefaultStyle(data.workspaceId, data.styleId);
    return { ok: true };
  });

// ── Files ──────────────────────────────────────────────────────────────────
export const startKitUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("brand-kit-upload")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        kind: z.enum(fileKinds),
        mime: z.string().max(100),
        bytes: z.number().int().positive(),
        fileName: z.string().max(200),
        frameCount: z.number().int().min(0).max(4).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<UploadTicket> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { startUpload } = await import("@/server/brand-kit/assets.server");
    return startUpload(data);
  });

export const finishKitUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        assetId: uuid,
        kind: z.enum(fileKinds),
        path: z.string().max(300),
        framePaths: z.array(z.string().max(300)).max(4).optional(),
        label: z.string().max(120).nullish(),
        styleId: uuid.nullish(),
        width: z.number().int().positive().max(20_000).nullish(),
        height: z.number().int().positive().max(20_000).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { finishUpload } = await import("@/server/brand-kit/assets.server");
    const result = await finishUpload({ ...data, userId: context.userId });
    if (result.analyze) {
      const { kickAnalysis } = await import("@/server/brand-kit/analyze.server");
      kickAnalysis(data.workspaceId, [result.assetId]);
    }
    return result;
  });

export const addWritingSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("brand-kit-upload")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        text: z.string().max(20_000).optional(),
        url: z.string().max(2048).optional(),
        label: z.string().max(120).nullish(),
        styleId: uuid.nullish(),
      })
      .refine((d) => !!(d.text?.trim() || d.url?.trim()), "Add text or a link")
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { addWritingSample: add } = await import("@/server/brand-kit/assets.server");
    const result = await add({ ...data, userId: context.userId });
    const { kickAnalysis } = await import("@/server/brand-kit/analyze.server");
    kickAnalysis(data.workspaceId, [result.assetId]);
    return result;
  });

export const updateKitAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        assetId: uuid,
        label: z.string().max(120).nullish(),
        tags: z.array(z.string().max(40)).max(12).optional(),
        styleId: uuid.nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    await (
      await store()
    ).updateAsset({
      workspaceId: data.workspaceId,
      assetId: data.assetId,
      patch: { label: data.label, tags: data.tags, styleId: data.styleId },
    });
    return { ok: true };
  });

export const deleteKitAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, assetId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    await (await store()).deleteAsset(data.workspaceId, data.assetId);
    return { ok: true };
  });

// ── Learning a style ───────────────────────────────────────────────────────
/** (Re)study examples — only pending, failed or stuck ones are actually paid for. */
export const analyzeKitAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("brand-kit-analyze")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, assetIds: z.array(uuid).min(1).max(12) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { kickAnalysis } = await import("@/server/brand-kit/analyze.server");
    kickAnalysis(data.workspaceId, data.assetIds);
    return { queued: data.assetIds.length };
  });

export const suggestStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, assetIds: z.array(uuid).min(1).max(24) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<Suggestion & { pending: number; failed: number }> => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { suggestFromAssets } = await import("@/server/brand-kit/analyze.server");
    return suggestFromAssets(data.workspaceId, data.assetIds);
  });

export const describeStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("brand-kit-analyze")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, description: z.string().trim().min(8).max(2000) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const [{ specFromDescription }, { readBrandDna }, { serializeBrandContext }] =
      await Promise.all([
        import("@/server/brand-kit/analyze.server"),
        import("@/server/workspaces/brand-dna.server"),
        import("@/lib/ai/brand-context"),
      ]);
    const stored = await readBrandDna(context.supabase, data.workspaceId);
    const brandText = serializeBrandContext((stored?.dna ?? null) as never, {
      maxCharsPerField: 200,
    });
    return specFromDescription({
      workspaceId: data.workspaceId,
      description: data.description,
      brandText,
    });
  });

/** "What the AI sees": the exact style text a generator receives. */
export const previewStylePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        styleId: z.union([uuid, z.literal("none")]).nullish(),
        format: z.enum(STYLE_FORMATS).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const [{ loadResolvedStyle }, prompt] = await Promise.all([
      import("@/server/brand-kit/resolve.server"),
      import("@/lib/brand-kit/prompt"),
    ]);
    const loaded = await loadResolvedStyle(data.workspaceId, data.styleId);
    const format = data.format ?? "social";
    return {
      writing: prompt.writingStyleBlock(loaded.resolved, format),
      visual: prompt.visualStyleBlock(loaded.resolved),
      video: prompt.videoStyleBlock(loaded.resolved),
      references: loaded.referenceUrls.length,
      fromDna: loaded.resolved.fromDna,
    };
  });
