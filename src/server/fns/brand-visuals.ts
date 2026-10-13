import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
import { FEEDBACK_REASONS, FORMATS, PURPOSES, ProfileSchema } from "@/lib/brand-visuals/contracts";
import type { WorkspaceRole } from "@/server/api-auth";
import * as service from "@/server/brand-visuals/service.server";

const ws = { workspaceId: z.string().uuid() };
export const restoreManualVisualLook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z.object({ ...ws, expectedActiveId: z.string().uuid().nullable() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await service.restoreManualVisualLook(c, data.expectedActiveId);
    return service.getVisualView(c);
  });
export const editVisualArtwork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({ ...ws, jobId: z.string().uuid(), headline: z.string().trim().min(1).max(120) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await service.editVisualArtwork(c, data);
    return { saved: true };
  });
export const learnVisualReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) => z.object({ ...ws, idempotencyKey: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    const job = await service.startReferenceAnalysis(c, data.idempotencyKey);
    kick(job.id, c.workspaceId);
    return service.getVisualView(c);
  });
async function caller(ctx: ServerFnContext, workspaceId: string, role: WorkspaceRole) {
  return {
    workspaceId,
    userId: ctx.userId,
    role: await requireWorkspaceRole(ctx, workspaceId, role),
  };
}
const kick = (id: string, workspaceId: string) =>
  after(async () => {
    try {
      await (
        await import("@/server/brand-visuals/worker.server")
      ).advanceVisualCapture(id, workspaceId);
    } catch (error) {
      console.error("[visual-taste] advance failed", error);
    }
  });
export const getVisualTaste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "viewer");
    const view = await service.getVisualView(c);
    const pending = view.jobs.find((j) => j.status === "queued" || j.status === "running");
    if (pending) kick(pending.id, c.workspaceId);
    return view;
  });
export const scanVisualWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        url: z.string().url().max(2048),
        idempotencyKey: z.string().uuid(),
        maxPages: z.number().int().min(1).max(8).default(4),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    const job = await service.startVisualCapture(c, data);
    kick(job.id, c.workspaceId);
    return service.getVisualView(c);
  });
export const addVisualReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        assetId: z.string().uuid(),
        label: z.string().trim().min(1).max(120),
        purpose: z.enum(PURPOSES),
        notes: z.string().max(600).default(""),
        formats: z.array(z.enum(FORMATS)).max(6).default([]),
        campaign: z.string().max(120).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await service.addVisualSource(c, data);
    return service.getVisualView(c);
  });
export const updateVisualReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        id: z.string().uuid(),
        status: z.enum(["candidate", "approved", "removed"]),
        notes: z.string().max(600).optional(),
        purpose: z.enum(PURPOSES).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await service.changeVisualSource(c, data);
    return service.getVisualView(c);
  });
export const saveVisualDirection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        profile: ProfileSchema,
        expectedActiveId: z.string().uuid().nullable(),
        confirm: z.boolean(),
        restoreId: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await service.saveVisualProfile(c, data);
    return service.getVisualView(c);
  });
export const giveVisualFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        jobId: z.string().uuid(),
        reason: z.enum(FEEDBACK_REASONS),
        note: z.string().max(600).default(""),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await service.recordVisualFeedback(c, data);
    return { saved: true };
  });
export const cancelVisualScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) => z.object({ ...ws, id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await (
      supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient
    )
      .from("brand_visual_capture_jobs")
      .update({ status: "cancelled", lease_token: null, lease_until: null })
      .eq("workspace_id", c.workspaceId)
      .eq("id", data.id)
      .in("status", ["queued", "running"]);
    if (result.error) throw new Error("The scan could not be cancelled.");
    return service.getVisualView(c);
  });
