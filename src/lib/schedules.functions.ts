import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue | undefined } | JsonValue[];

const uuid = z.string().uuid();

export const CadenceEnum = z.enum(["once", "hourly", "daily", "weekly"]);
export const TaskTypeEnum = z.enum([
  "social-post",
  "content-gen",
  "seo-audit",
  "crm-message",
  "custom",
]);

const COLS =
  "id, workspace_id, title, task_type, channel, agent, cadence, timezone, next_run_at, last_run_at, last_run_status, last_run_error, last_content_item_id, run_count, active, prompt, meta, created_by, created_at, updated_at";

export type ScheduledJob = {
  id: string;
  workspace_id: string;
  title: string;
  task_type: string;
  channel: string | null;
  agent: string;
  cadence: "once" | "hourly" | "daily" | "weekly";
  timezone: string;
  next_run_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_content_item_id: string | null;
  run_count: number;
  active: boolean;
  prompt: string | null;
  meta: JsonValue | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/* List */
export const listScheduledJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid.optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("scheduled_jobs")
      .select(COLS)
      .order("next_run_at", { ascending: true });
    if (data.workspaceId) q = q.eq("workspace_id", data.workspaceId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ScheduledJob[];
  });

/* Create */
const CreateSchema = z.object({
  workspaceId: uuid,
  title: z.string().min(1).max(160),
  taskType: TaskTypeEnum.default("social-post"),
  channel: z.string().max(40).optional().nullable(),
  agent: z.enum(["scout", "spark", "echo"]).default("spark"),
  cadence: CadenceEnum.default("once"),
  nextRunAt: z.string().datetime(),
  prompt: z.string().max(2000).optional().nullable(),
  timezone: z.string().max(64).optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const createScheduledJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CreateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("scheduled_jobs")
      .insert({
        workspace_id: data.workspaceId,
        title: data.title,
        task_type: data.taskType,
        channel: data.channel ?? null,
        agent: data.agent,
        cadence: data.cadence,
        timezone: data.timezone ?? "UTC",
        next_run_at: data.nextRunAt,
        prompt: data.prompt ?? null,
        meta: (data.meta ?? {}) as never,
        created_by: context.userId,
      })
      .select(COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to create job");
    return row as ScheduledJob;
  });

/* Update */
const UpdateSchema = z.object({
  id: uuid,
  patch: z
    .object({
      title: z.string().min(1).max(160).optional(),
      channel: z.string().max(40).nullable().optional(),
      agent: z.enum(["scout", "spark", "echo"]).optional(),
      cadence: CadenceEnum.optional(),
      nextRunAt: z.string().datetime().optional(),
      prompt: z.string().max(2000).nullable().optional(),
      active: z.boolean().optional(),
      taskType: TaskTypeEnum.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, "Empty patch"),
});

export const updateScheduledJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    const p = data.patch;
    if (p.title !== undefined) patch.title = p.title;
    if (p.channel !== undefined) patch.channel = p.channel;
    if (p.agent !== undefined) patch.agent = p.agent;
    if (p.cadence !== undefined) patch.cadence = p.cadence;
    if (p.nextRunAt !== undefined) patch.next_run_at = p.nextRunAt;
    if (p.prompt !== undefined) patch.prompt = p.prompt;
    if (p.active !== undefined) patch.active = p.active;
    if (p.taskType !== undefined) patch.task_type = p.taskType;
    const { data: row, error } = await context.supabase
      .from("scheduled_jobs")
      .update(patch as never)
      .eq("id", data.id)
      .select(COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Update failed");
    return row as ScheduledJob;
  });

/* Delete */
export const deleteScheduledJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("scheduled_jobs")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* Run now — fires the scheduler executor immediately for one job */
export const runScheduledJobNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("scheduled_jobs")
      .update({ next_run_at: new Date().toISOString() } as never)
      .eq("id", data.id)
      .select(COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed");
    // Trigger the executor in the background (best-effort).
    try {
      const mod = await import("./schedules.server");
      await mod.runDueScheduledJobs({ onlyJobId: data.id });
    } catch (e) {
      console.warn("runDueScheduledJobs inline failed", e);
    }
    return row as ScheduledJob;
  });