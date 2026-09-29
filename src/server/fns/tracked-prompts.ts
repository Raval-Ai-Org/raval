import "server-only";
import { z } from "zod";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";

// Tracked prompts (src/server/geo/tracked-prompts.server.ts). Reading needs
// membership; adding, pausing, deleting and "Check now" need editor. The plan
// limit is pooled across the account's brands; "Check now" costs credits.

const uuid = z.string().uuid();

async function planFor(
  workspaceId: string,
  userId: string,
  role: "owner" | "admin" | "editor" | "viewer",
) {
  const { optionalWorkspaceEntitlements } = await import("@/server/billing/readiness.server");
  const entitlements = await optionalWorkspaceEntitlements({ workspaceId, userId, role });
  return {
    limit: entitlements?.limits.trackedPrompts ?? 5,
    engines: (entitlements?.limits.engines ?? ["chatgpt", "gemini"]).filter(
      (engine) => engine !== "google_aio",
    ),
    enforce: entitlements?.enforcement === "on",
  };
}

export const getTrackedPrompts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const plan = await planFor(data.workspaceId, context.userId, role);
    const svc = await import("@/server/geo/tracked-prompts.server");
    return svc.listTrackedPrompts({
      supabase: context.supabase as never,
      workspaceId: data.workspaceId,
      limit: plan.limit,
      engines: plan.engines,
    });
  });

export const suggestTrackedPrompts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const svc = await import("@/server/geo/tracked-prompts.server");
    return { suggestions: await svc.suggestTrackedPrompts(data.workspaceId) };
  });

export const addTrackedPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, text: z.string().trim().min(3).max(300) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const plan = await planFor(data.workspaceId, context.userId, role);
    const svc = await import("@/server/geo/tracked-prompts.server");
    await svc.addTrackedPrompt({
      workspaceId: data.workspaceId,
      userId: context.userId,
      text: data.text,
      limit: plan.limit,
      enforce: plan.enforce,
    });
    return { ok: true as const };
  });

export const setTrackedPromptPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, promptId: uuid, paused: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const plan = await planFor(data.workspaceId, context.userId, role);
    const svc = await import("@/server/geo/tracked-prompts.server");
    await svc.setTrackedPromptPaused({ ...data, limit: plan.limit, enforce: plan.enforce });
    return { ok: true as const };
  });

export const deleteTrackedPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, promptId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const svc = await import("@/server/geo/tracked-prompts.server");
    await svc.deleteTrackedPrompt(data.workspaceId, data.promptId);
    return { ok: true as const };
  });

/** "Check now": outside the weekly schedule, so it costs credits. */
export const checkTrackedPromptNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, promptId: uuid, idempotencyKey: uuid.optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const plan = await planFor(data.workspaceId, context.userId, role);
    const { data: prompt } = await context.supabase
      .from("geo_tracked_prompts" as never)
      .select("id,text" as never)
      .eq("id" as never, data.promptId)
      .eq("workspace_id" as never, data.workspaceId)
      .maybeSingle();
    const row = prompt as { id: string; text: string } | null;
    if (!row) throw new Error("Prompt not found");
    const svc = await import("@/server/geo/tracked-prompts.server");
    const { runMetered } = await import("@/server/billing/metered.server");
    const { result } = await runMetered(
      {
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        action: "prompt_check_3_engines",
        idempotencyKey: data.idempotencyKey ?? crypto.randomUUID(),
        route: "geo.probe",
      },
      async (charge) => {
        const out = await svc.checkTrackedPrompt({
          promptId: row.id,
          workspaceId: data.workspaceId,
          text: row.text,
          engines: plan.engines,
        });
        if (out.checked === 0) charge.setCapturedAmount(0);
        return out;
      },
    );
    return result;
  });
