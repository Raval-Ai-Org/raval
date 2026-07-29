// Server-only scheduler executor. Generates content via Lovable AI for each
// due scheduled_jobs row and inserts a pending content_items entry.
// Imported only inside server handlers (cron route + run-now server fn).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runJsonPrompt } from "./ai";
import { SCHEDULE_SYSTEMS } from "./ai/prompts";
import { assemble } from "./ai/prompts/assemble";

type Cadence = "once" | "hourly" | "daily" | "weekly";

const KIND_BY_TYPE: Record<string, string> = {
  "social-post": "post",
  "content-gen": "blog",
  "seo-audit": "brief",
  "crm-message": "email",
  custom: "post",
};


function computeNext(prev: Date, cadence: Cadence): Date | null {
  const now = new Date();
  const next = new Date(prev);
  // Advance until strictly in the future, so a backlogged job doesn't re-fire instantly.
  const stepMs = cadence === "hourly"
    ? 60 * 60 * 1000
    : cadence === "daily"
    ? 24 * 60 * 60 * 1000
    : cadence === "weekly"
    ? 7 * 24 * 60 * 60 * 1000
    : 0;
  if (stepMs === 0) return null;
  do { next.setTime(next.getTime() + stepMs); } while (next <= now);
  return next;
}

async function loadBrandContext(workspaceId: string): Promise<string> {
  try {
    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("name, industry, audience, goals, website_url, brand_voice")
      .eq("id", workspaceId)
      .single();
    if (!ws) return "";
    const brand = (ws.brand_voice ?? {}) as Record<string, unknown>;
    const lines: string[] = [];
    if (ws.name) lines.push(`Brand: ${ws.name}`);
    if (ws.industry) lines.push(`Industry: ${ws.industry}`);
    if (ws.audience) lines.push(`Audience: ${ws.audience}`);
    if (ws.goals) lines.push(`Goals: ${ws.goals}`);
    if (ws.website_url) lines.push(`Website: ${ws.website_url}`);
    if (brand.voice) lines.push(`Voice: ${String(brand.voice)}`);
    if (brand.values) lines.push(`Values: ${Array.isArray(brand.values) ? (brand.values as unknown[]).join(", ") : String(brand.values)}`);
    if (brand.products) lines.push(`Products: ${Array.isArray(brand.products) ? (brand.products as unknown[]).join(", ") : String(brand.products)}`);
    if (brand.do) lines.push(`Do: ${Array.isArray(brand.do) ? (brand.do as unknown[]).join(", ") : String(brand.do)}`);
    if (brand.dont) lines.push(`Don't: ${Array.isArray(brand.dont) ? (brand.dont as unknown[]).join(", ") : String(brand.dont)}`);
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function generateOne(args: {
  taskType: string;
  channel: string | null;
  prompt: string | null;
  brandContext: string;
  jobTitle: string;
}): Promise<{ title: string; body: string; hashtags: string[] }> {
  const system = SCHEDULE_SYSTEMS[args.taskType] ?? SCHEDULE_SYSTEMS["social-post"];
  const user = assemble([
    { body: `Scheduled task: ${args.jobTitle}` },
    { body: args.channel ? `Channel: ${args.channel}` : "" },
    { body: args.prompt ? `Specific instructions: ${args.prompt}` : "" },
    { label: "Brand context", body: args.brandContext, maxChars: 3000 },
    { body: "Generate the piece now, specific to this brand, ready to publish." },
  ]);

  try {
    const parsed = await runJsonPrompt<{ title?: string; body?: string; hashtags?: string[] }>({
      route: `schedule.${args.taskType}`,
      system, user,
      fallback: {},
      maxTokens: 1100,
      temperature: 0.7,
    });
    return {
      title: (parsed.title ?? args.jobTitle).slice(0, 280),
      body: (parsed.body ?? "").slice(0, 8000),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 30) : [],
    };
  } catch {
    return {
      title: args.jobTitle,
      body: `${args.brandContext || "Brand"}\n\nScheduled draft for ${args.channel ?? "your channel"}. Configure AI gateway to enable rich generation.`,
      hashtags: [],
    };
  }
}


export async function runDueScheduledJobs(opts: { onlyJobId?: string; max?: number } = {}) {
  const nowIso = new Date().toISOString();
  let q = supabaseAdmin
    .from("scheduled_jobs")
    .select("id, workspace_id, title, task_type, channel, agent, cadence, prompt, next_run_at, created_by")
    .eq("active", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(opts.max ?? 25);
  if (opts.onlyJobId) q = q.eq("id", opts.onlyJobId);

  const { data: jobs, error } = await q;
  if (error) throw new Error(error.message);
  if (!jobs?.length) return { ran: 0 };

  let ran = 0;
  for (const job of jobs) {
    try {
      const brandContext = await loadBrandContext(job.workspace_id);
      const piece = await generateOne({
        taskType: job.task_type,
        channel: job.channel,
        prompt: job.prompt,
        brandContext,
        jobTitle: job.title,
      });

      const kind = KIND_BY_TYPE[job.task_type] ?? "post";
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("content_items")
        .insert({
          workspace_id: job.workspace_id,
          agent: job.agent,
          kind,
          channel: job.channel,
          title: piece.title,
          body: piece.body,
          hashtags: piece.hashtags,
          status: "pending",
          created_by: job.created_by,
          meta: { source: "schedule", scheduled_job_id: job.id, ran_at: nowIso } as never,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);

      const cadence = job.cadence as Cadence;
      const next = computeNext(new Date(job.next_run_at), cadence);
      await supabaseAdmin.from("scheduled_jobs").update({
        last_run_at: nowIso,
        last_run_status: "ok",
        last_run_error: null,
        last_content_item_id: inserted?.id ?? null,
        run_count: undefined as never, // ignored; we increment via RPC-less update below
        next_run_at: next ? next.toISOString() : job.next_run_at,
        active: next ? true : false,
      } as never).eq("id", job.id);

      // Increment run_count in a second statement (avoid raw SQL dependency).
      await supabaseAdmin.rpc as unknown; // no-op placeholder; counts updated via fetch+update below
      // Best-effort increment:
      try {
        const { data: cur } = await supabaseAdmin
          .from("scheduled_jobs")
          .select("run_count")
          .eq("id", job.id)
          .single();
        await supabaseAdmin
          .from("scheduled_jobs")
          .update({ run_count: ((cur?.run_count as number | undefined) ?? 0) + 1 } as never)
          .eq("id", job.id);
      } catch {}
      ran++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("scheduled job failed", job.id, msg);
      await supabaseAdmin.from("scheduled_jobs").update({
        last_run_at: nowIso,
        last_run_status: "error",
        last_run_error: msg.slice(0, 500),
      } as never).eq("id", job.id);
    }
  }
  return { ran };
}