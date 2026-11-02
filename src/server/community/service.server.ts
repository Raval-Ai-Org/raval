// service.server.ts — Community Intelligence: the daily refresh and the view.
//
// Background model, the same as competitors (src/server/competitors/
// service.server.ts): one community_jobs row per workspace, created when a
// person first asks Mellox to look; an interactive request kicks it with
// after(); the existing competitor-watch cron hook claims whatever is due
// (claim_community_jobs, SKIP LOCKED); every write carries the lease. A run
// reschedules itself a day later. No new cron job.
//
// Reads for the screen use the caller's RLS client. Writes use the service
// role, after the server fn checked the caller's role.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isCommunityEnabled, isRedditApiEnabled } from "@/lib/feature-flags";
import { runWithScope } from "@/server/request-context";
import { webResearchAvailable } from "@/server/research/web-search.server";
import { HttpError } from "@/server/http-error";
import {
  COMMUNITY_SOURCES,
  MANUAL_REFRESH_MIN_HOURS,
  MATCH_KINDS,
  MAX_THREADS_SHOWN,
  MAX_WATCHES,
  REFRESH_HOURS,
  THREAD_STATUSES,
  type CommunityHome,
  type CommunityJobState,
  type CommunityReply,
  type CommunitySource,
  type CommunityThreadView,
  type CommunityWatch,
  type CommunityWatchKind,
  type MatchKind,
  type ThreadStatus,
} from "@/lib/community/contracts";
import {
  buildCommunityQueries,
  cleanTerm,
  stackSiteOf,
  subredditOf,
} from "@/lib/community/queries";
import { communitySignals } from "@/lib/community/signals";
import { mergeThreads } from "@/lib/community/threads";
import { loadCommunityBrand } from "./context.server";

const WORKER = `community-${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 150;
const MAX_ATTEMPTS = 5;
/** New threads read by the classifier per run; the rest wait for tomorrow. */
const MAX_NEW_PER_RUN = 40;
const HOUR = 3_600_000;

const admin = () => supabaseAdmin as unknown as SupabaseClient;

type JobRow = {
  id: string;
  workspace_id: string;
  status: string;
  next_run_at: string;
  last_run_at: string | null;
  last_found: number;
  last_error: string | null;
  attempt_count: number;
  locked_by: string | null;
};

type ThreadRow = {
  id: string;
  url: string;
  source: string;
  community: string;
  title: string;
  snippet: string;
  summary: string;
  matched_on: string;
  matched_term: string;
  competitor_name: string | null;
  relevance: number;
  status: string;
  reply: unknown;
  posted_at: string | null;
  found_at: string;
};

export const THREAD_COLUMNS =
  "id, url, source, community, title, snippet, summary, matched_on, matched_term, competitor_name, relevance, status, reply, posted_at, found_at";

function readReply(value: unknown): CommunityReply | null {
  const r = value as Partial<CommunityReply> | null;
  if (!r || typeof r.text !== "string" || !r.text.trim()) return null;
  return {
    text: r.text,
    disclosed: r.disclosed === true,
    removed: typeof r.removed === "number" ? r.removed : 0,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
  };
}

export function toThreadView(row: ThreadRow): CommunityThreadView {
  return {
    id: row.id,
    url: row.url,
    source: (COMMUNITY_SOURCES as readonly string[]).includes(row.source)
      ? (row.source as CommunitySource)
      : "reddit",
    community: row.community,
    title: row.title,
    snippet: row.snippet,
    summary: row.summary,
    matchedOn: (MATCH_KINDS as readonly string[]).includes(row.matched_on)
      ? (row.matched_on as MatchKind)
      : "category",
    matchedTerm: row.matched_term,
    competitorName: row.competitor_name,
    relevance: row.relevance,
    postedAt: row.posted_at,
    foundAt: row.found_at,
    status: (THREAD_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as ThreadStatus)
      : "new",
    reply: readReply(row.reply),
  };
}

/* ───────────────────────────── the view ───────────────────────────── */

export async function getCommunityHome(
  db: SupabaseClient,
  workspaceId: string,
): Promise<CommunityHome> {
  const [threads, watches, job, competitors] = await Promise.all([
    db
      .from("community_threads")
      .select(THREAD_COLUMNS)
      .eq("workspace_id", workspaceId)
      .neq("status", "hidden")
      .order("found_at", { ascending: false })
      .limit(MAX_THREADS_SHOWN),
    db
      .from("community_watches")
      .select("id, kind, value")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    db
      .from("community_jobs")
      .select("status, next_run_at, last_run_at, last_found, last_error")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("workspace_competitors")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("status", "tracked")
      .limit(12),
  ]);
  if (threads.error) throw new HttpError(503, "Could not load community threads.");
  const views = ((threads.data ?? []) as ThreadRow[]).map(toThreadView);
  const j = job.data as Omit<JobRow, "id" | "workspace_id" | "attempt_count" | "locked_by"> | null;
  return {
    threads: views,
    watches: ((watches.data ?? []) as CommunityWatch[]).map((w) => ({
      id: w.id,
      kind: w.kind,
      value: w.value,
    })),
    signals: communitySignals(
      views,
      ((competitors.data ?? []) as { name: string }[]).map((c) => c.name),
    ),
    job: {
      state: (j?.status as CommunityJobState | undefined) ?? "never",
      lastRunAt: j?.last_run_at ?? null,
      nextRunAt: j?.next_run_at ?? null,
      lastFound: j?.last_found ?? 0,
      error: j?.status === "failed" || j?.status === "idle" ? (j?.last_error ?? null) : null,
    },
    webSearch: webResearchAvailable(),
    redditApi: isRedditApiEnabled(),
  };
}

export async function getCommunityThread(
  db: SupabaseClient,
  workspaceId: string,
  threadId: string,
): Promise<CommunityThreadView> {
  const { data } = await db
    .from("community_threads")
    .select(THREAD_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", threadId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "That thread isn't here any more.");
  return toThreadView(data as ThreadRow);
}

/* ───────────────────────────── changes ───────────────────────────── */

export async function setThreadStatus(
  workspaceId: string,
  threadId: string,
  status: ThreadStatus,
): Promise<void> {
  const { data, error } = await admin()
    .from("community_threads")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", threadId)
    .select("id")
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not save that.");
  if (!data) throw new HttpError(404, "That thread isn't here any more.");
}

/** A watch value as stored, or an error message a person can act on. */
export function normalizeWatch(kind: CommunityWatchKind, raw: string): string | { error: string } {
  if (kind === "community") {
    const t = raw.trim();
    const site = stackSiteOf(t);
    if (site) return site;
    const sub = subredditOf(/^\/?r\//i.test(t) || /reddit\.com/i.test(t) ? t : `r/${t}`);
    return sub ? `r/${sub}` : { error: "Use a subreddit like r/espresso." };
  }
  const term = cleanTerm(raw);
  return term.length >= 2 ? term : { error: "Type a few words." };
}

export async function addWatch(
  workspaceId: string,
  userId: string,
  kind: CommunityWatchKind,
  raw: string,
): Promise<void> {
  const value = normalizeWatch(kind, raw);
  if (typeof value !== "string") throw new HttpError(400, value.error);
  const { count } = await admin()
    .from("community_watches")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count ?? 0) >= MAX_WATCHES) throw new HttpError(400, `You can keep up to ${MAX_WATCHES}.`);
  const { error } = await admin()
    .from("community_watches")
    .insert({ workspace_id: workspaceId, kind, value, created_by: userId });
  // The unique index makes a repeat a no-op.
  if (error && error.code !== "23505") throw new HttpError(503, "Could not save that.");
}

export async function removeWatch(workspaceId: string, watchId: string): Promise<void> {
  const { error } = await admin()
    .from("community_watches")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", watchId);
  if (error) throw new HttpError(503, "Could not remove that.");
}

/**
 * A person asks Mellox to look. The first time this creates the daily job.
 * A refresh that ran in the last few hours is not repeated.
 */
export async function requestRefresh(
  workspaceId: string,
  userId: string,
): Promise<{ started: boolean; reason?: "recent" | "running" }> {
  const { data: existing } = await admin()
    .from("community_jobs")
    .select("id, status, last_run_at, lease_until")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const row = existing as {
    status: string;
    last_run_at: string | null;
    lease_until: string | null;
  } | null;
  if (row?.status === "running" && row.lease_until && Date.parse(row.lease_until) > Date.now()) {
    return { started: false, reason: "running" };
  }
  if (
    row?.last_run_at &&
    row.status !== "paused" &&
    Date.now() - Date.parse(row.last_run_at) < MANUAL_REFRESH_MIN_HOURS * HOUR
  ) {
    return { started: false, reason: "recent" };
  }
  const now = new Date().toISOString();
  const { error } = await admin().from("community_jobs").upsert(
    {
      workspace_id: workspaceId,
      status: "queued",
      next_run_at: now,
      requested_by: userId,
      attempt_count: 0,
      last_error: null,
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new HttpError(503, "Could not start looking.");
  kickCommunity(workspaceId);
  return { started: true };
}

/** Stop the daily refresh; the threads stay. */
export async function pauseRefresh(workspaceId: string): Promise<void> {
  const { error } = await admin()
    .from("community_jobs")
    .update({ status: "paused", lease_until: null, locked_by: null })
    .eq("workspace_id", workspaceId);
  if (error) throw new HttpError(503, "Could not pause.");
}

/** Store a reply draft on its thread. */
export async function saveReply(
  workspaceId: string,
  threadId: string,
  reply: CommunityReply,
): Promise<void> {
  const { error } = await admin()
    .from("community_threads")
    .update({ reply })
    .eq("workspace_id", workspaceId)
    .eq("id", threadId);
  if (error) console.error("[community] could not store the draft", error.message);
}

/* ───────────────────────────── the worker ───────────────────────────── */

async function patchLeased(
  id: string,
  worker: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin()
    .from("community_jobs")
    .update(patch)
    .eq("id", id)
    .eq("locked_by", worker)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[community] lease patch failed", error.message);
    return false;
  }
  return Boolean(data);
}

function release(extra: Record<string, unknown>, status: string, hours = REFRESH_HOURS) {
  return {
    status,
    lease_until: null,
    locked_by: null,
    next_run_at: new Date(Date.now() + hours * HOUR).toISOString(),
    ...extra,
  };
}

type Outcome = "done" | "failed" | "skipped" | "lost_lease";

async function advance(row: JobRow): Promise<Outcome> {
  const worker = row.locked_by ?? WORKER;
  if (!isCommunityEnabled(row.workspace_id)) {
    await patchLeased(row.id, worker, release({}, "idle"));
    return "skipped";
  }
  if (row.attempt_count > MAX_ATTEMPTS) {
    await patchLeased(
      row.id,
      worker,
      release(
        { last_error: "Stopped after repeated failures. Press Look again to retry." },
        "failed",
      ),
    );
    return "failed";
  }

  return runWithScope({ workspaceId: row.workspace_id, route: "community.refresh" }, async () => {
    try {
      const brand = await loadCommunityBrand(row.workspace_id);
      const queries = buildCommunityQueries(brand);
      if (!queries.length) {
        await patchLeased(
          row.id,
          worker,
          release(
            {
              last_run_at: new Date().toISOString(),
              last_found: 0,
              attempt_count: 0,
              last_error:
                "Add your field, a product or a competitor so Mellox knows what to look for.",
            },
            "idle",
          ),
        );
        return "done";
      }
      const [{ runCommunityQueries }, { classifyThreads }] = await Promise.all([
        import("./discover.server"),
        import("./classify.server"),
      ]);
      const { data: known } = await admin()
        .from("community_threads")
        .select("fingerprint")
        .eq("workspace_id", row.workspace_id)
        .order("found_at", { ascending: false })
        .limit(2000);
      const knownSet = new Set(
        ((known ?? []) as { fingerprint: string }[]).map((k) => k.fingerprint),
      );
      const { threads } = await runCommunityQueries(queries, brand);
      const fresh = mergeThreads(threads, knownSet).slice(0, MAX_NEW_PER_RUN);
      const classified = fresh.length
        ? await classifyThreads({
            threads: fresh,
            brandLine: brand.facts.slice(0, 1_500),
            competitors: brand.competitors,
          })
        : [];

      let found = 0;
      if (classified.length) {
        // ignoreDuplicates: the unique (workspace_id, fingerprint) index is the
        // real guard, so a race with a manual refresh is a no-op.
        const { data, error } = await admin()
          .from("community_threads")
          .upsert(
            classified.map((t) => ({
              workspace_id: row.workspace_id,
              url: t.url,
              source: t.source,
              community: t.community.slice(0, 120),
              title: t.title.slice(0, 300),
              snippet: t.snippet.slice(0, 800),
              summary: t.summary.slice(0, 300),
              matched_on: t.matchedOn,
              matched_term: t.matchedTerm.slice(0, 120),
              competitor_name: t.competitorName,
              relevance: t.relevance,
              posted_at: t.postedAt,
              fingerprint: t.fingerprint,
            })),
            { onConflict: "workspace_id,fingerprint", ignoreDuplicates: true },
          )
          .select("id");
        if (error) console.error("[community] could not store threads", error.message);
        else found = (data ?? []).length;
      }
      if (found > 0) {
        // New threads can be worth a post: let Autopilot judge (no-op when off).
        const { requestOpportunityScan } = await import("@/server/autopilot/service.server");
        await requestOpportunityScan(row.workspace_id);
      }
      const ok = await patchLeased(
        row.id,
        worker,
        release(
          {
            last_run_at: new Date().toISOString(),
            last_found: found,
            attempt_count: 0,
            last_error: null,
          },
          "idle",
        ),
      );
      return ok ? "done" : "lost_lease";
    } catch (error) {
      const message = error instanceof Error ? error.message : "The refresh failed";
      console.error(`[community] refresh for ${row.workspace_id} failed`, error);
      // Try again in an hour; MAX_ATTEMPTS stops a loop.
      await patchLeased(row.id, worker, {
        status: "queued",
        lease_until: null,
        locked_by: null,
        last_error: message.slice(0, 2000),
        next_run_at: new Date(Date.now() + HOUR).toISOString(),
      });
      return "failed";
    }
  });
}

async function claim(max: number, workspaceId?: string): Promise<JobRow[]> {
  const { data, error } = await admin().rpc("claim_community_jobs", {
    p_worker: WORKER,
    p_max: max,
    p_lease_seconds: LEASE_SECONDS,
    p_workspace_id: workspaceId ?? null,
  });
  if (error) {
    console.error("[community] claim failed", error.message);
    return [];
  }
  return (data ?? []) as JobRow[];
}

/** Continue after the response is sent, so the request returns at once. */
export function kickCommunity(workspaceId: string): void {
  after(async () => {
    try {
      const [row] = await claim(1, workspaceId);
      if (row) await advance({ ...row, locked_by: WORKER });
    } catch (error) {
      console.error(`[community] background refresh for ${workspaceId} failed`, error);
    }
  });
}

/** Cron entry, from the existing competitor-watch hook. */
export async function runDueCommunityJobs(
  opts: { budgetMs?: number; max?: number } = {},
): Promise<Record<Outcome | "claimed", number>> {
  const deadline = Date.now() + (opts.budgetMs ?? 30_000);
  const max = opts.max ?? 2;
  const tally = { claimed: 0, done: 0, failed: 0, skipped: 0, lost_lease: 0 };
  while (tally.claimed < max && Date.now() < deadline - 15_000) {
    const [row] = await claim(1);
    if (!row) break;
    tally.claimed += 1;
    tally[await advance({ ...row, locked_by: WORKER })] += 1;
  }
  return tally;
}
