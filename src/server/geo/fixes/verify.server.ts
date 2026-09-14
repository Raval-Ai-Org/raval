// verify.server.ts — confirms fixes on the live site.
//
// A verification is a leased job: each attempt runs a targeted scan of the
// affected pages (scan-runner "targeted" mode) and evaluates the finding's rule
// on the result (src/lib/geo/verify.ts). After a merged pull request the first
// attempt waits for the deploy, and failed attempts retry on a schedule
// (GEO_FIX_VERIFY_DELAYS, minutes). Only an explicit pass on an analysed page
// resolves a finding; everything else leaves it open with the evidence.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { RuleCheckState } from "@/lib/geo/fix-contracts";
import type { SiteArtifacts } from "@/lib/geo/types";
import { evaluateVerification, type VerificationTarget } from "@/lib/geo/verify";
import { recordAudit } from "@/server/audit.server";
import { createScan, driveScan } from "../service.server";
import { pageRowToCrawled, type PageRow } from "../store.server";
import { VERIFICATION_COLS, type VerificationRow } from "./present";

const WORKER = `geo-verify-${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 240;

/** Minutes after a merge before each attempt (deploys take time). */
export function verifyDelaysMinutes(): number[] {
  const parsed = (process.env.GEO_FIX_VERIFY_DELAYS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 24 * 60);
  return (parsed.length ? parsed : [5, 15, 45]).slice(0, 10);
}

function targetUrls(origin: string, targets: VerificationTarget[]): string[] {
  return [...new Set(targets.map((t) => t.pageUrl ?? `${origin}/`))].slice(0, 20);
}

export async function scheduleVerification(args: {
  workspaceId: string;
  userId: string | null;
  proposalId: string | null;
  /** "Fix all": one verification for every finding in the batch's pull request. */
  batchId?: string | null;
  origin: string;
  targets: VerificationTarget[];
  baselineScanId: string | null;
  before: Record<string, RuleCheckState>;
  /** Minutes from now for each attempt; [0] = one attempt now. */
  delaysMinutes: number[];
}): Promise<VerificationRow> {
  if (args.proposalId) {
    const { data: live } = await supabaseAdmin
      .from("geo_verifications")
      .select(VERIFICATION_COLS)
      .eq("proposal_id", args.proposalId)
      .in("status", ["scheduled", "running"])
      .limit(1)
      .maybeSingle();
    if (live) return live as unknown as VerificationRow;
  }
  if (args.batchId) {
    const { data: live } = await supabaseAdmin
      .from("geo_verifications")
      .select(VERIFICATION_COLS)
      .eq("batch_id", args.batchId)
      .in("status", ["scheduled", "running"])
      .limit(1)
      .maybeSingle();
    if (live) return live as unknown as VerificationRow;
  }
  const delays = args.delaysMinutes.length ? args.delaysMinutes : [0];
  const { data, error } = await supabaseAdmin
    .from("geo_verifications")
    .insert({
      workspace_id: args.workspaceId,
      proposal_id: args.proposalId,
      batch_id: args.batchId ?? null,
      origin: args.origin,
      fingerprints: [...new Set(args.targets.map((t) => t.fingerprint))].slice(0, 50),
      rule_ids: [...new Set(args.targets.map((t) => t.ruleId))],
      urls: targetUrls(args.origin, args.targets),
      baseline_scan_id: args.baselineScanId,
      before: args.before as unknown as Json,
      after: { delays, targets: args.targets } as unknown as Json,
      max_attempts: delays.length,
      next_attempt_at: new Date(Date.now() + delays[0] * 60_000).toISOString(),
      created_by: args.userId,
    })
    .select(VERIFICATION_COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't schedule the verification");
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "geo.verification.scheduled",
    entity: "geo_verification",
    payload: {
      verificationId: data.id,
      proposalId: args.proposalId,
      urls: data.urls,
      attempts: delays.length,
    },
  });
  return data as unknown as VerificationRow;
}

type Stored = {
  delays?: number[];
  targets?: VerificationTarget[];
  /** Batch verifications: fingerprints already confirmed fixed on earlier attempts. */
  resolved?: string[];
  checks?: Record<string, RuleCheckState>;
};

function storedTargets(row: VerificationRow): VerificationTarget[] {
  const stored = (row.after ?? {}) as Stored;
  if (stored.targets?.length) return stored.targets;
  return row.fingerprints.map((fingerprint, i) => ({
    fingerprint,
    ruleId: row.rule_ids[i] ?? fingerprint.split("|")[0],
    pageUrl: null,
  }));
}

async function update(row: VerificationRow, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("geo_verifications")
    .update(patch as never)
    .eq("id", row.id)
    .eq("locked_by", WORKER);
  if (error) throw new Error(error.message);
  Object.assign(row, patch);
}

async function setProposalStatus(
  row: VerificationRow,
  status: string,
  error: string | null = null,
) {
  if (row.batch_id && status === "verifying") {
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status })
      .eq("batch_id", row.batch_id)
      .in("status", ["merged", "pr_open"]);
    await supabaseAdmin
      .from("geo_fix_batches")
      .update({ status: "verifying" })
      .eq("id", row.batch_id)
      .in("status", ["merged", "pr_open"]);
    return;
  }
  if (!row.proposal_id) return;
  await supabaseAdmin
    .from("geo_fix_proposals")
    .update({ status, ...(error !== undefined ? { error } : {}) })
    .eq("id", row.proposal_id)
    .in("status", ["merged", "verifying", "not_verified", "pr_open"]);
}

/** Retry later, or conclude when attempts are used up. */
async function retryOrConclude(
  row: VerificationRow,
  outcome: "not_verified" | "failed",
  detail: string,
  checks: Record<string, RuleCheckState>,
  regressions: unknown[],
) {
  const stored = (row.after ?? {}) as Stored;
  const delays = stored.delays ?? [0];
  const keep = { delays: stored.delays, targets: stored.targets, checks, regressions };
  if (row.attempts < row.max_attempts) {
    const waitMin = Math.max(1, (delays[row.attempts] ?? 10) - (delays[row.attempts - 1] ?? 0));
    await update(row, {
      status: "scheduled",
      scan_id: null,
      after: keep,
      outcome_detail: `${detail} Checking again in about ${waitMin} minute(s) (attempt ${row.attempts + 1} of ${row.max_attempts}).`,
      next_attempt_at: new Date(Date.now() + waitMin * 60_000).toISOString(),
      lease_until: null,
    });
    return;
  }
  await update(row, {
    status: outcome,
    after: keep,
    outcome_detail: detail,
    completed_at: new Date().toISOString(),
    lease_until: null,
  });
  await setProposalStatus(row, "not_verified", detail.slice(0, 2000));
  await recordAudit({
    workspaceId: row.workspace_id,
    userId: null,
    action: `geo.verification.${outcome}`,
    entity: "geo_verification",
    payload: { verificationId: row.id, proposalId: row.proposal_id, detail },
  });
}

async function conclude(row: VerificationRow) {
  const { data: scan, error } = await supabaseAdmin
    .from("geo_scans")
    .select("id, status, error, site")
    .eq("id", row.scan_id!)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scan) return retryOrConclude(row, "failed", "The verification scan disappeared.", {}, []);
  if (scan.status === "queued" || scan.status === "running") return "pending" as const;
  if (scan.status !== "succeeded") {
    return retryOrConclude(
      row,
      "failed",
      `The verification scan ${scan.status}${scan.error ? `: ${scan.error}` : ""}.`,
      {},
      [],
    );
  }

  const { data: pageRows, error: pagesError } = await supabaseAdmin
    .from("geo_scan_pages")
    .select(
      "id, url, final_url, depth, state, status_code, content_type, fetch_ms, skip_reason, x_robots_tag, analysis",
    )
    .eq("scan_id", scan.id);
  if (pagesError) throw new Error(pagesError.message);

  let baselineFingerprints: string[] = [];
  if (row.baseline_scan_id) {
    const { data: base } = await supabaseAdmin
      .from("geo_findings")
      .select("fingerprint")
      .eq("scan_id", row.baseline_scan_id)
      .limit(5000);
    baselineFingerprints = (base ?? []).map((f) => f.fingerprint);
  }

  const targets = storedTargets(row);
  const decision = evaluateVerification({
    targets,
    site: scan.site as unknown as SiteArtifacts,
    pages: ((pageRows ?? []) as unknown as PageRow[]).map(pageRowToCrawled),
    baselineFingerprints: row.baseline_scan_id
      ? baselineFingerprints
      : targets.map((t) => t.fingerprint),
  });

  if (row.batch_id) return concludeBatch(row, targets, decision);

  if (decision.outcome !== "verified") {
    return retryOrConclude(
      row,
      decision.outcome === "not_verified" ? "not_verified" : "failed",
      decision.detail,
      decision.after,
      decision.regressions,
    );
  }

  const now = new Date().toISOString();
  const stored = (row.after ?? {}) as Stored;
  await update(row, {
    status: "verified",
    after: {
      delays: stored.delays,
      targets: stored.targets,
      checks: decision.after,
      regressions: decision.regressions,
    },
    outcome_detail: decision.detail,
    completed_at: now,
    lease_until: null,
  });
  // Only now does a finding become resolved.
  const { error: stateError } = await supabaseAdmin.from("geo_finding_states").upsert(
    row.fingerprints.map((fingerprint) => ({
      workspace_id: row.workspace_id,
      fingerprint,
      state: "resolved",
      resolved_via: "verified",
      verified_at: now,
      verification_id: row.id,
      reopened_at: null,
      note: "Verified fixed by a Mellox rescan of the live site.",
      updated_by: row.created_by,
      updated_at: now,
    })),
    { onConflict: "workspace_id,fingerprint" },
  );
  if (stateError) throw new Error(stateError.message);
  await setProposalStatus(row, "verified", null);
  await recordAudit({
    workspaceId: row.workspace_id,
    userId: null,
    action: "geo.verification.verified",
    entity: "geo_verification",
    payload: {
      verificationId: row.id,
      proposalId: row.proposal_id,
      fingerprints: row.fingerprints,
      scanId: row.scan_id,
      regressions: decision.regressions.length,
    },
  });
  return "done" as const;
}

async function resolveFingerprints(row: VerificationRow, fingerprints: string[], now: string) {
  if (!fingerprints.length) return;
  const { error } = await supabaseAdmin.from("geo_finding_states").upsert(
    fingerprints.map((fingerprint) => ({
      workspace_id: row.workspace_id,
      fingerprint,
      state: "resolved",
      resolved_via: "verified",
      verified_at: now,
      verification_id: row.id,
      reopened_at: null,
      note: "Verified fixed by a Mellox rescan of the live site.",
      updated_by: row.created_by,
      updated_at: now,
    })),
    { onConflict: "workspace_id,fingerprint" },
  );
  if (error) throw new Error(error.message);
}

/**
 * "Fix all": each finding is judged on its own. Passing findings are resolved
 * immediately; the rest are re-checked on the remaining attempts, then marked
 * not verified. A merged pull request never resolves anything by itself.
 */
async function concludeBatch(
  row: VerificationRow,
  targets: VerificationTarget[],
  decision: ReturnType<typeof evaluateVerification>,
): Promise<"done"> {
  const now = new Date().toISOString();
  const stored = (row.after ?? {}) as Stored;
  const passed = targets.filter((t) => decision.after[t.fingerprint]?.status === "pass");
  const passedSet = new Set(passed.map((t) => t.fingerprint));
  const remaining = targets.filter((t) => !passedSet.has(t.fingerprint));
  const resolved = [...new Set([...(stored.resolved ?? []), ...passedSet])];
  const checks = { ...(stored.checks ?? {}), ...decision.after };
  const total = resolved.length + remaining.length;

  if (passed.length) {
    await resolveFingerprints(row, [...passedSet], now);
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status: "verified", error: null })
      .eq("batch_id", row.batch_id!)
      .in("fingerprint", [...passedSet])
      .in("status", ["merged", "verifying", "not_verified", "pr_open"]);
  }

  const keep = {
    delays: stored.delays,
    targets: remaining,
    resolved,
    checks,
    regressions: decision.regressions,
  };

  if (!remaining.length) {
    await update(row, {
      status: "verified",
      after: keep,
      outcome_detail: `All ${total} fix(es) are confirmed on the live site.`,
      completed_at: now,
      lease_until: null,
    });
    await supabaseAdmin
      .from("geo_fix_batches")
      .update({ status: "completed" })
      .eq("id", row.batch_id!);
  } else if (row.attempts < row.max_attempts) {
    const delays = stored.delays ?? [0];
    const waitMin = Math.max(1, (delays[row.attempts] ?? 10) - (delays[row.attempts - 1] ?? 0));
    await update(row, {
      status: "scheduled",
      scan_id: null,
      after: keep,
      outcome_detail: `${resolved.length} of ${total} fix(es) confirmed so far; ${remaining.length} not yet visible on the live site. Checking again in about ${waitMin} minute(s) (attempt ${row.attempts + 1} of ${row.max_attempts}).`,
      next_attempt_at: new Date(Date.now() + waitMin * 60_000).toISOString(),
      lease_until: null,
    });
    return "done";
  } else {
    const detail = `${resolved.length} of ${total} fix(es) confirmed on the live site; ${remaining.length} still fail and stay open.`;
    await update(row, {
      status: "not_verified",
      after: keep,
      outcome_detail: detail,
      completed_at: now,
      lease_until: null,
    });
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status: "not_verified", error: "The live site still fails this check." })
      .eq("batch_id", row.batch_id!)
      .in(
        "fingerprint",
        remaining.map((t) => t.fingerprint),
      )
      .in("status", ["merged", "verifying", "pr_open"]);
    await supabaseAdmin
      .from("geo_fix_batches")
      .update({ status: "completed" })
      .eq("id", row.batch_id!);
  }
  await recordAudit({
    workspaceId: row.workspace_id,
    userId: null,
    action: remaining.length ? "geo.verification.partial" : "geo.verification.verified",
    entity: "geo_verification",
    payload: {
      verificationId: row.id,
      batchId: row.batch_id,
      resolved: resolved.length,
      stillFailing: remaining.length,
      scanId: row.scan_id,
    },
  });
  return "done";
}

/** Advance one claimed verification: start its scan, drive it, evaluate. */
async function advance(row: VerificationRow, deadline: number): Promise<"done" | "pending"> {
  if (!row.scan_id) {
    let scanId: string;
    try {
      const scan = await createScan({
        workspaceId: row.workspace_id,
        userId: row.created_by,
        url: row.origin,
        mode: "targeted",
        trigger: "verification",
        urls: row.urls,
      });
      scanId = scan.id;
    } catch (error) {
      await update(row, { attempts: row.attempts + 1 });
      await retryOrConclude(
        row,
        "failed",
        `Couldn't start the verification scan: ${error instanceof Error ? error.message : "unknown error"}.`,
        {},
        [],
      );
      return "done";
    }
    await update(row, { scan_id: scanId, attempts: row.attempts + 1 });
    if (row.proposal_id || row.batch_id) await setProposalStatus(row, "verifying");
  }
  const budget = deadline - Date.now() - 5_000;
  if (budget > 5_000) await driveScan(row.scan_id!, { budgetMs: Math.min(budget, 60_000) });
  const result = await conclude(row);
  if (result === "pending") {
    // Keep the job; release the lease so the next tick picks it up.
    await update(row, {
      status: "running",
      lease_until: new Date(Date.now() - 1000).toISOString(),
    });
    return "pending";
  }
  return "done";
}

export async function runDueVerifications(
  opts: { budgetMs?: number; max?: number; id?: string } = {},
) {
  const deadline = Date.now() + (opts.budgetMs ?? 60_000);
  const results = { claimed: 0, done: 0, pending: 0, errors: 0 };
  while (results.claimed < (opts.max ?? 2) && Date.now() < deadline - 10_000) {
    const { data, error } = await supabaseAdmin.rpc("claim_geo_verifications", {
      p_worker: WORKER,
      p_max: 1,
      p_lease_seconds: LEASE_SECONDS,
      ...(opts.id ? { p_id: opts.id } : {}),
    });
    if (error) throw new Error(`claim_geo_verifications failed: ${error.message}`);
    const row = (data as unknown as VerificationRow[] | null)?.[0];
    if (!row) break;
    results.claimed++;
    try {
      results[await advance(row, deadline)]++;
    } catch (err) {
      results.errors++;
      console.error(`[geo] verification ${row.id} failed`, err);
      await supabaseAdmin
        .from("geo_verifications")
        .update({ lease_until: new Date(Date.now() + 60_000).toISOString() })
        .eq("id", row.id);
    }
    if (opts.id) break;
  }
  return results;
}

/** Run a verification now, after the response is sent. */
export function kickVerification(id: string): void {
  after(async () => {
    try {
      await runDueVerifications({ id, budgetMs: 120_000, max: 1 });
    } catch (error) {
      console.error(`[geo] verification ${id} kick failed`, error);
    }
  });
}

export async function loadVerification(id: string): Promise<VerificationRow | null> {
  const { data } = await supabaseAdmin
    .from("geo_verifications")
    .select(VERIFICATION_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as VerificationRow) ?? null;
}
