// service.server.ts — the lifecycle of a competitor.
//
// Background model, the same four parts GEO scans use (see
// src/server/geo/service.server.ts) so there is one mental model for async
// work in this codebase:
//   1. a row is created, tracked, and given a next_check_at;
//   2. an interactive request kicks it with after() so the user sees progress
//      without holding the response open;
//   3. pg_cron claims whatever has a due check and an expired lease, through
//      the competitor-watch hook that is already scheduled;
//   4. every write carries the lease, so two workers can never both advance
//      the same competitor.
//
// next_check_at backs off when nothing is happening: a competitor that has
// been quiet for weeks is checked weekly, not daily. A quiet market should
// cost almost nothing.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { runWithScope } from "@/server/request-context";
import { hostOf } from "@/lib/research/sources";
import { buildCompetitorProfile } from "./profile.server";
import { detectCompetitorUpdates, lookbackDays } from "./updates.server";
import type { CompetitorProfile } from "@/lib/competitors/contracts";

const WORKER = `competitors-${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 150;
// A competitor whose lease keeps expiring is stuck, not unlucky. After this
// many attempts it is left alone until someone asks for it by hand, rather
// than burning a search and a model call every sweep forever.
const MAX_ATTEMPTS = 20;

const QUIET_BACKOFF_HOURS = [24, 48, 72, 168] as const;

type CompetitorRow = {
  id: string;
  workspace_id: string;
  name: string;
  domain: string;
  url: string | null;
  status: string;
  profile: unknown;
  profile_status: string;
  profile_updated_at: string | null;
  updates_checked_at: string | null;
  attempt_count: number;
  locked_by: string | null;
};

/**
 * Patch a competitor only while this worker still holds the lease. Returns
 * false when the lease was lost — the caller must stop, because another worker
 * is now the one advancing this row.
 */
type CompetitorPatch = Database["public"]["Tables"]["workspace_competitors"]["Update"];

async function patchLeased(id: string, worker: string, patch: CompetitorPatch): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("workspace_competitors")
    .update(patch)
    .eq("id", id)
    .eq("locked_by", worker)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[competitors] lease patch failed", error.message);
    return false;
  }
  return Boolean(data);
}

/** When to look at this competitor again, given what the last sweep found. */
export function nextCheckAt(args: {
  foundSomething: boolean;
  quietSweeps: number;
  now?: number;
}): string {
  const now = args.now ?? Date.now();
  if (args.foundSomething) return new Date(now + 24 * 3600_000).toISOString();
  const index = Math.min(args.quietSweeps, QUIET_BACKOFF_HOURS.length - 1);
  return new Date(now + QUIET_BACKOFF_HOURS[index] * 3600_000).toISOString();
}

/**
 * Advance one claimed competitor: profile it if it has never been profiled,
 * then look for what changed. Profiling is the more valuable half, so it goes
 * first and a failure there still lets the updates sweep run next time.
 */
async function advanceCompetitor(row: CompetitorRow): Promise<"done" | "lost_lease" | "failed"> {
  const worker = row.locked_by ?? WORKER;
  const url = row.url || `https://${row.domain}`;

  if (row.attempt_count > MAX_ATTEMPTS) {
    await patchLeased(row.id, worker, {
      profile_status: row.profile ? "ready" : "failed",
      profile_error: row.profile
        ? null
        : "Gave up after repeated failures. Research it again to retry.",
      lease_until: null,
      locked_by: null,
      next_check_at: nextCheckAt({ foundSomething: false, quietSweeps: 3 }),
    });
    return "failed";
  }

  return runWithScope({ workspaceId: row.workspace_id, route: "competitors.advance" }, async () => {
    let profiled = false;
    if (!row.profile || row.profile_status === "pending" || row.profile_status === "failed") {
      if (!(await patchLeased(row.id, worker, { profile_status: "running" }))) return "lost_lease";
      try {
        const profile = await buildCompetitorProfile({
          name: row.name,
          domain: row.domain,
          url,
        });
        const ok = await patchLeased(row.id, worker, {
          profile,
          profile_status: "ready",
          profile_error: null,
          profile_updated_at: new Date().toISOString(),
        });
        if (!ok) return "lost_lease";
        profiled = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not research this website";
        // A failed profile is recorded on the row, not thrown away: the UI
        // shows the user why rather than an endless spinner.
        await patchLeased(row.id, worker, {
          profile_status: "failed",
          profile_error: message.slice(0, 2000),
        });
      }
    }

    let found = 0;
    try {
      const { data: existing } = await supabaseAdmin
        .from("competitor_updates")
        .select("fingerprint")
        .eq("competitor_id", row.id)
        .order("detected_at", { ascending: false })
        .limit(200);
      const { updates } = await detectCompetitorUpdates({
        name: row.name,
        domain: row.domain,
        lastCheckedAt: row.updates_checked_at,
        knownFingerprints: (existing ?? []).map((entry) => entry.fingerprint),
      });
      if (updates.length) {
        // ignoreDuplicates: the unique index on (competitor_id, fingerprint)
        // is the real guard, so a race between the cron and a manual refresh
        // is a no-op rather than an error.
        const { error } = await supabaseAdmin.from("competitor_updates").upsert(
          updates.map((update) => ({
            workspace_id: row.workspace_id,
            competitor_id: row.id,
            kind: update.kind,
            title: update.title,
            summary: update.summary || null,
            significance: update.significance,
            source_url: update.sourceUrl,
            source_title: update.sourceTitle,
            published_at: update.publishedAt,
            fingerprint: update.fingerprint,
          })),
          { onConflict: "competitor_id,fingerprint", ignoreDuplicates: true },
        );
        if (error) console.error("[competitors] failed to store updates", error.message);
        else found = updates.length;
      }
    } catch (error) {
      console.error("[competitors] update sweep failed", error);
    }

    const quietSweeps = row.updates_checked_at
      ? Math.min(3, Math.floor(lookbackDays(row.updates_checked_at) / 2))
      : 0;
    const released = await patchLeased(row.id, worker, {
      updates_checked_at: new Date().toISOString(),
      lease_until: null,
      locked_by: null,
      attempt_count: 0,
      next_check_at: nextCheckAt({ foundSomething: found > 0 || profiled, quietSweeps }),
    });
    return released ? "done" : "lost_lease";
  });
}

async function claim(max: number, competitorId?: string): Promise<CompetitorRow[]> {
  const { data, error } = await supabaseAdmin.rpc("claim_competitor_jobs", {
    p_worker: WORKER,
    p_max: max,
    p_lease_seconds: LEASE_SECONDS,
    p_competitor_id: competitorId ?? undefined,
  });
  if (error) {
    console.error("[competitors] claim failed", error.message);
    return [];
  }
  return (data ?? []) as unknown as CompetitorRow[];
}

/** Research one competitor now, in the caller's process. */
export async function driveCompetitor(competitorId: string): Promise<string> {
  const [row] = await claim(1, competitorId);
  if (!row) return "not_claimed";
  return advanceCompetitor({ ...row, locked_by: WORKER });
}

/** Continue after the current response is sent, so the request returns at once. */
export function kickCompetitor(competitorId: string): void {
  after(async () => {
    try {
      await driveCompetitor(competitorId);
    } catch (error) {
      console.error(`[competitors] background research for ${competitorId} failed`, error);
    }
  });
}

/**
 * Cron entry: advance whatever is due, sequentially, inside the budget.
 * Called from the competitor-watch hook, which is already scheduled — this
 * feature adds no new cron job.
 */
export async function runDueCompetitorJobs(
  opts: { budgetMs?: number; max?: number } = {},
): Promise<{ claimed: number; done: number; failed: number; lost_lease: number }> {
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const max = opts.max ?? 3;
  const tally = { claimed: 0, done: 0, failed: 0, lost_lease: 0 };
  while (tally.claimed < max && Date.now() < deadline - 15_000) {
    const [row] = await claim(1);
    if (!row) break;
    tally.claimed += 1;
    const result = await advanceCompetitor({ ...row, locked_by: WORKER });
    tally[result] += 1;
  }
  return tally;
}

/** Normalised competitor identity. Exported for the server fns and tests. */
export function normalizeCompetitorDomain(raw: string): string {
  const trimmed = raw.trim();
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return hostOf(url);
}

export type { CompetitorProfile };
