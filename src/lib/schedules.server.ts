// Server-only scheduler executor. Generates content via the configured AI provider for each
// due scheduled_jobs row and inserts a pending content_items entry.
// Imported only inside server handlers (cron route + run-now server fn).
//
// Jobs are CLAIMED atomically (public.claim_due_scheduled_jobs — FOR UPDATE
// SKIP LOCKED with a lease) so overlapping cron invocations never run the same
// job twice. Each job runs in a request scope attributed to its workspace, so
// its model spend is metered and checked against that workspace's budget.
// A generation that fails records the error on the job — it no longer inserts
// an empty or placeholder "draft" and reports success.

import "server-only";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runWithScope } from "@/server/request-context";
import { runStructuredPrompt } from "./ai";
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

/** A lease longer than the cron hook's 120 s timeout, so a live run is never re-claimed. */
const LEASE_SECONDS = 300;

const PieceSchema = z.object({
  title: z.string().optional(),
  body: z.string().min(1),
  hashtags: z.array(z.string()).optional(),
});

export function computeNext(prev: Date, cadence: Cadence, now = new Date()): Date | null {
  const next = new Date(prev);
  // Advance until strictly in the future, so a backlogged job doesn't re-fire instantly.
  const stepMs =
    cadence === "hourly"
      ? 60 * 60 * 1000
      : cadence === "daily"
        ? 24 * 60 * 60 * 1000
        : cadence === "weekly"
          ? 7 * 24 * 60 * 60 * 1000
          : 0;
  if (stepMs === 0) return null;
  do {
    next.setTime(next.getTime() + stepMs);
  } while (next <= now);
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
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).join(", ") : String(v));
    const lines: string[] = [];
    if (ws.name) lines.push(`Brand: ${ws.name}`);
    if (ws.industry) lines.push(`Industry: ${ws.industry}`);
    if (ws.audience) lines.push(`Audience: ${ws.audience}`);
    if (ws.goals) lines.push(`Goals: ${ws.goals}`);
    if (ws.website_url) lines.push(`Website: ${ws.website_url}`);
    if (brand.voice) lines.push(`Voice: ${String(brand.voice)}`);
    if (brand.values) lines.push(`Values: ${list(brand.values)}`);
    if (brand.products) lines.push(`Products: ${list(brand.products)}`);
    if (brand.do) lines.push(`Do: ${list(brand.do)}`);
    if (brand.dont) lines.push(`Don't: ${list(brand.dont)}`);
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

  // Throws AiOutputError / provider errors — handled by the caller as a job error.
  const parsed = await runStructuredPrompt({
    route: `schedule.${args.taskType}`,
    system,
    user,
    schema: PieceSchema,
    maxTokens: args.taskType === "content-gen" ? 3000 : 1400,
    temperature: 0.7,
    // A recurring job must produce a new piece each run, not the cached one.
    regenerate: true,
  });
  return {
    title: (parsed.title ?? args.jobTitle).slice(0, 280),
    body: parsed.body.slice(0, 8000),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 30) : [],
  };
}

type ClaimedJob = {
  id: string;
  workspace_id: string;
  title: string;
  task_type: string;
  channel: string | null;
  agent: string;
  cadence: string;
  prompt: string | null;
  next_run_at: string;
  created_by: string | null;
  run_count: number | null;
};

/**
 * PostgREST reports a missing RPC as PGRST202. The claim function ships in
 * migration 20260911120400; until it is applied (the live project lags the
 * repo — see docs/OPERATIONS-RUNBOOK.md) the scheduler falls back to the
 * legacy unlocked query instead of failing every minute.
 */
export function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /claim_due_scheduled_jobs|could not find the function/i.test(error.message ?? "")
  );
}

const LEASE_RELEASE = { locked_at: null, locked_by: null };

async function claimJobs(opts: { onlyJobId?: string; max?: number }): Promise<{
  jobs: ClaimedJob[];
  leased: boolean;
}> {
  const { data: claimed, error } = await supabaseAdmin.rpc("claim_due_scheduled_jobs", {
    p_max: opts.max ?? 25,
    p_lease_seconds: LEASE_SECONDS,
    p_market_brain: false,
    p_job_id: opts.onlyJobId,
  });
  if (!error) return { jobs: (claimed ?? []) as unknown as ClaimedJob[], leased: true };
  if (!isMissingRpc(error)) throw new Error(error.message);

  console.warn("[schedules] claim_due_scheduled_jobs missing — legacy unlocked sweep");
  let q = supabaseAdmin
    .from("scheduled_jobs")
    .select(
      "id, workspace_id, title, task_type, channel, agent, cadence, prompt, next_run_at, created_by, run_count",
    )
    .eq("active", true)
    .neq("task_type", "market-brain")
    .order("next_run_at", { ascending: true })
    .limit(opts.max ?? 25);
  if (opts.onlyJobId) q = q.eq("id", opts.onlyJobId);
  else q = q.lte("next_run_at", new Date().toISOString());
  const { data, error: legacyError } = await q;
  if (legacyError) throw new Error(legacyError.message);
  return { jobs: (data ?? []) as ClaimedJob[], leased: false };
}

async function runJob(job: ClaimedJob, nowIso: string, leased: boolean): Promise<boolean> {
  // Lease columns exist only once the claim migration is applied.
  const release = leased ? LEASE_RELEASE : {};
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
        // Always lands in the approval queue: a scheduled job drafts, a human approves.
        status: "pending",
        created_by: job.created_by,
        meta: { source: "schedule", scheduled_job_id: job.id, ran_at: nowIso } as never,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    const next = computeNext(new Date(job.next_run_at), job.cadence as Cadence);
    await supabaseAdmin
      .from("scheduled_jobs")
      .update({
        last_run_at: nowIso,
        last_run_status: "ok",
        last_run_error: null,
        last_content_item_id: inserted?.id ?? null,
        run_count: (job.run_count ?? 0) + 1,
        next_run_at: next ? next.toISOString() : job.next_run_at,
        active: Boolean(next),
        ...release,
      })
      .eq("id", job.id);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("scheduled job failed", job.id, msg);
    // Release the lease; the job retries on the next sweep after its lease.
    await supabaseAdmin
      .from("scheduled_jobs")
      .update({
        last_run_at: nowIso,
        last_run_status: "error",
        last_run_error: msg.slice(0, 500),
        ...release,
      })
      .eq("id", job.id);
    return false;
  }
}

export async function runDueScheduledJobs(opts: { onlyJobId?: string; max?: number } = {}) {
  const nowIso = new Date().toISOString();
  const { jobs, leased } = await claimJobs(opts);
  if (!jobs.length) return { ran: 0, failed: 0 };

  let ran = 0;
  let failed = 0;
  for (const job of jobs) {
    // Attribute this job's AI spend to its workspace (metering + budgets).
    const ok = await runWithScope(
      {
        workspaceId: job.workspace_id,
        userId: job.created_by ?? undefined,
        route: `schedule.${job.task_type}`,
      },
      () => runJob(job, nowIso, leased),
    );
    if (ok) ran++;
    else failed++;
  }
  return { ran, failed };
}
