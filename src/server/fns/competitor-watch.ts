import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

export type CompetitorWatch = {
  id: string;
  workspace_id: string;
  url: string;
  name: string | null;
  enabled: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type CompetitorAlert = {
  id: string;
  workspace_id: string;
  watch_id: string;
  kind: "new_page" | "promotion" | "positioning" | "title" | "cta";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string | null;
  before_value: string | null;
  after_value: string | null;
  source_url: string | null;
  read_at: string | null;
  detected_at: string;
};

export const listCompetitorWatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workspaceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("competitor_watches")
      .select("id, workspace_id, url, name, enabled, last_checked_at, last_error, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as CompetitorWatch[];
  });

export const addCompetitorWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        workspaceId: uuid,
        url: z.string().min(3).max(2048),
        name: z.string().max(120).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const clean = data.url.trim().replace(/\/+$/, "");
    const url = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    const { assertPublicUrl } = await import("@/server/api-auth");
    try {
      assertPublicUrl(url);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Invalid URL");
    }
    const { data: row, error } = await context.supabase
      .from("competitor_watches")
      .insert({
        workspace_id: data.workspaceId,
        url,
        name: data.name ?? null,
        created_by: context.userId,
      })
      .select("id, workspace_id, url, name, enabled, last_checked_at, last_error, created_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to add watch");
    // Fire an initial baseline scan (no alerts on first snapshot) in the background.
    try {
      const { scanWatch } = await import("@/lib/competitor-watch.server");
      await scanWatch(row.id);
    } catch {
      /* baseline failure is non-fatal */
    }
    return row as CompetitorWatch;
  });

export const removeCompetitorWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("competitor_watches").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleCompetitorWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("competitor_watches")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runCompetitorWatchNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    // Verify caller is a member of the watch's workspace via RLS SELECT.
    const { data: row, error: readErr } = await context.supabase
      .from("competitor_watches")
      .select("id")
      .eq("id", data.id)
      .single();
    if (readErr || !row) throw new Error("Not authorized");
    const { scanWatch } = await import("@/lib/competitor-watch.server");
    return scanWatch(data.id);
  });

export const listCompetitorAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        workspaceId: uuid,
        limit: z.number().int().min(1).max(200).optional(),
        unreadOnly: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("competitor_alerts")
      .select(
        "id, workspace_id, watch_id, kind, severity, title, detail, before_value, after_value, source_url, read_at, detected_at",
      )
      .eq("workspace_id", data.workspaceId)
      .order("detected_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.unreadOnly) q = q.is("read_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as CompetitorAlert[];
  });

export const markCompetitorAlertsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        workspaceId: uuid,
        ids: z.array(uuid).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("competitor_alerts")
      .update({ read_at: new Date().toISOString() })
      .eq("workspace_id", data.workspaceId)
      .is("read_at", null);
    if (data.ids && data.ids.length > 0) q = q.in("id", data.ids);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
