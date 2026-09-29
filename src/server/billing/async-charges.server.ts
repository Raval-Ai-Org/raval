import "server-only";

// Charges for background AI jobs (GEO Engineer runs, "Fix all", competitor
// reports and profiles, Brand Kit voice re-analysis).
//
//   const charge = await beginAsyncCharge({ ..., action: "competitor_intel" });
//   const run = await startTheJob();          // throws → charge.release()
//   await charge.link("competitor_intel", run.id);
//
// The hold is taken before any work, so an empty balance stops the job before
// it starts. Settlement reads the job's own status: success captures, failure
// or a job that never finishes releases. Workers call settleAsyncCharge at
// their final transition; the billing cron settles whatever they missed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_ACTIONS, creditsFor, type CreditAction } from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { beginDeferredMetered } from "./metered.server";
import { captureMeter, releaseMeter } from "./meters.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export type AsyncChargeKind =
  "geo_agent_run" | "fix_batch" | "competitor_intel" | "competitor_profile" | "brand_voice";

type Role = "owner" | "admin" | "editor" | "viewer";

export type AsyncCharge = {
  /** Attach the hold to the job row. Call once the row exists. */
  link: (kind: AsyncChargeKind, refId: string) => Promise<void>;
  /** The job never started (refused, joined an existing run, threw). */
  release: () => Promise<void>;
};

const NOOP: AsyncCharge = { link: async () => undefined, release: async () => undefined };

const EXPIRY_MS: Partial<Record<AsyncChargeKind, number>> = {
  // A GEO Engineer run can wait days for a person to answer its questions.
  geo_agent_run: 7 * 86_400_000,
};

export async function beginAsyncCharge(args: {
  workspaceId: string;
  userId: string;
  role: Role;
  kind: AsyncChargeKind;
  action: CreditAction;
  quantity?: number;
  /** Stable per click (the client's key) or per job request. */
  requestKey: string;
  route?: string;
}): Promise<AsyncCharge> {
  const amount = creditsFor(args.action, args.quantity ?? 1);
  if (amount < 1) return NOOP;
  const deferred = await beginDeferredMetered({
    workspaceId: args.workspaceId,
    userId: args.userId,
    role: args.role,
    actionName: args.action,
    meter: "credits",
    amount,
    feature: CREDIT_ACTIONS[args.action].feature,
    idempotencyKey: `${args.kind}:${args.requestKey}`,
    route: args.route,
    expiresAt: new Date(Date.now() + (EXPIRY_MS[args.kind] ?? 3 * 3_600_000)).toISOString(),
  });
  if (deferred.mode === "off") return NOOP;
  let linked = false;
  return {
    async link(kind, refId) {
      if (linked) return;
      const { error } = await admin.from("billing_async_links").insert({
        kind,
        ref_id: refId,
        account_id: deferred.accountId,
        workspace_id: args.workspaceId,
        hold_id: deferred.holdId,
        charge_id: deferred.chargeId,
        charge_key: `${args.userId}:${args.action}:${args.kind}:${args.requestKey}`,
        action: args.action,
        amount,
        mode: deferred.mode,
        shadow_decision: deferred.shadowDecision,
      });
      if (error) {
        await deferred.release();
        throw new HttpError(503, "Billing is temporarily unavailable. Nothing was charged.");
      }
      linked = true;
      // A job that already finished inline settles now.
      await settleAsyncCharge(kind, refId).catch((cause) =>
        console.error("[billing] inline async settle failed", kind, cause),
      );
    },
    async release() {
      if (!linked) await deferred.release();
    },
  };
}

type Outcome =
  { final: false } | { final: true; ok: false } | { final: true; ok: true; units?: number };

type LinkRow = {
  kind: AsyncChargeKind;
  ref_id: string;
  account_id: string;
  workspace_id: string | null;
  hold_id: string | null;
  charge_id: string | null;
  charge_key: string;
  action: string;
  amount: number;
  mode: "shadow" | "on";
  shadow_decision: string | null;
  created_at: string;
  settled_at: string | null;
};

const HOUR = 3_600_000;
const age = (link: LinkRow) => Date.now() - new Date(link.created_at).getTime();

/** Agent runs that got as far as a reviewed fix did their paid work. */
export const AGENT_DONE = new Set([
  "awaiting_patch_approval",
  "applying",
  "pr_open",
  "merged",
  "rescan_pending",
  "verified_fixed",
  "not_verified",
]);
export const AGENT_FAILED = new Set(["failed", "not_fixable", "cancelled", "stale", "closed"]);

/** Decide the outcome of a job from its own row. Exported for tests. */
export function outcomeFor(
  kind: AsyncChargeKind,
  row: Record<string, unknown> | null,
  linkAgeMs: number,
): Outcome {
  if (!row) return linkAgeMs > HOUR ? { final: true, ok: false } : { final: false };
  switch (kind) {
    case "geo_agent_run": {
      const status = String(row.status);
      if (AGENT_DONE.has(status) || row.proposal_id) return { final: true, ok: true };
      if (AGENT_FAILED.has(status)) return { final: true, ok: false };
      return { final: false };
    }
    case "fix_batch": {
      const status = String(row.status);
      if (status === "generating") {
        return linkAgeMs > 2 * HOUR ? { final: true, ok: false } : { final: false };
      }
      const items = Array.isArray(row.items) ? (row.items as Array<{ status?: string }>) : [];
      const generated = items.filter((item) => item.status === "generated").length;
      if (status === "failed" || generated === 0) return { final: true, ok: false };
      return { final: true, ok: true, units: generated };
    }
    case "competitor_intel": {
      const status = String(row.status);
      if (status === "succeeded") return { final: true, ok: true };
      if (status === "failed") return { final: true, ok: false };
      return linkAgeMs > 0.5 * HOUR ? { final: true, ok: false } : { final: false };
    }
    case "competitor_profile": {
      const status = String(row.profile_status ?? "");
      if (status === "ready") return { final: true, ok: true };
      if (status === "failed") return { final: true, ok: false };
      return linkAgeMs > 24 * HOUR ? { final: true, ok: false } : { final: false };
    }
    case "brand_voice": {
      const status = String(row.analysis_status ?? "");
      if (status === "done") return { final: true, ok: true };
      if (status === "failed" || status === "none") return { final: true, ok: false };
      return linkAgeMs > 24 * HOUR ? { final: true, ok: false } : { final: false };
    }
  }
}

async function jobRow(kind: AsyncChargeKind, refId: string) {
  const q = (() => {
    switch (kind) {
      case "geo_agent_run":
        return admin.from("geo_agent_runs").select("status,proposal_id").eq("id", refId);
      case "fix_batch":
        return admin.from("geo_fix_batches").select("status,items").eq("id", refId);
      case "competitor_intel":
        return admin.from("competitor_intelligence_runs").select("status").eq("id", refId);
      case "competitor_profile":
        // ref_id is "<competitor id>:<request time>".
        return admin
          .from("workspace_competitors")
          .select("profile_status")
          .eq("id", refId.split(":")[0]);
      case "brand_voice":
        return admin.from("brand_kit_assets").select("analysis_status").eq("id", refId);
    }
  })();
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`Could not read ${kind} ${refId}`);
  return (data as Record<string, unknown> | null) ?? null;
}

/** Settle one job's charge if the job has finished. Safe to call repeatedly. */
export async function settleAsyncCharge(kind: AsyncChargeKind, refId: string): Promise<void> {
  const { data, error } = await admin
    .from("billing_async_links")
    .select("*")
    .eq("kind", kind)
    .eq("ref_id", refId)
    .maybeSingle();
  if (error || !data) return;
  const link = data as LinkRow;
  if (link.settled_at) return;
  const outcome = outcomeFor(kind, await jobRow(kind, refId), age(link));
  if (!outcome.final) return;
  let captured = 0;
  if (outcome.ok) {
    const per = CREDIT_ACTIONS[link.action as CreditAction]?.credits ?? link.amount;
    captured = Math.min(link.amount, outcome.units ? per * outcome.units : link.amount);
  }
  if (link.mode === "on" && link.hold_id) {
    if (captured > 0) {
      await captureMeter({
        accountId: link.account_id,
        holdId: link.hold_id,
        amount: captured,
        idempotencyKey: link.charge_key,
        chargeId: link.charge_id ?? undefined,
        finalize: true,
      });
    } else {
      await releaseMeter({
        accountId: link.account_id,
        holdId: link.hold_id,
        idempotencyKey: `${link.charge_key}:failed`,
        reason: "Background job did not finish",
      });
    }
  } else if (link.mode === "shadow" && captured > 0) {
    await admin.from("billing_shadow_events").insert({
      account_id: link.account_id,
      workspace_id: link.workspace_id,
      action: link.action,
      meter: "credits",
      amount: captured,
      decision: link.shadow_decision ?? "would_charge",
      reason: null,
    });
  }
  await admin
    .from("billing_async_links")
    .update({ settled_at: new Date().toISOString(), captured })
    .eq("kind", kind)
    .eq("ref_id", refId)
    .is("settled_at", null);
  if (captured > 0 && link.mode === "on") {
    const { checkLowBalance } = await import("./notify.server");
    await checkLowBalance(link.account_id).catch(() => undefined);
  }
}

/** Fire and forget from a worker's final transition. */
export function settleAsyncChargeSoon(kind: AsyncChargeKind, refId: string): void {
  void settleAsyncCharge(kind, refId).catch((cause) =>
    console.error("[billing] async settle failed", kind, refId, cause),
  );
}

/** A competitor's profile finished: settle every open profile charge for it. */
export function settleCompetitorProfileSoon(competitorId: string): void {
  void (async () => {
    const { data } = await admin
      .from("billing_async_links")
      .select("ref_id")
      .eq("kind", "competitor_profile")
      .like("ref_id", `${competitorId}:%`)
      .is("settled_at", null);
    for (const row of data ?? []) await settleAsyncCharge("competitor_profile", String(row.ref_id));
  })().catch((cause) => console.error("[billing] profile settle failed", competitorId, cause));
}

/**
 * Charge a competitor profile when research will really run (new, failed or
 * a full refresh); an already researched competitor costs nothing.
 */
export async function chargeCompetitorProfile(args: {
  workspaceId: string;
  userId: string;
  role: Role;
  competitorId: string;
  profileStatus: string | null | undefined;
}): Promise<void> {
  if (args.profileStatus === "ready" || args.profileStatus === "running") return;
  const requestKey = `${args.competitorId}:${Date.now()}`;
  const charge = await beginAsyncCharge({
    workspaceId: args.workspaceId,
    userId: args.userId,
    role: args.role,
    kind: "competitor_profile",
    action: "competitor_profile",
    requestKey,
    route: "competitors.profile",
  });
  await charge.link("competitor_profile", requestKey);
}

/** Billing cron: settle open links whose jobs have ended. */
export async function settleOpenAsyncCharges(limit = 40): Promise<number> {
  const { data, error } = await admin
    .from("billing_async_links")
    .select("kind,ref_id")
    .is("settled_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error("Could not load open background charges.");
  let settled = 0;
  for (const row of data ?? []) {
    try {
      await settleAsyncCharge(row.kind as AsyncChargeKind, String(row.ref_id));
      settled++;
    } catch (cause) {
      console.error("[billing] cron async settle failed", row.kind, row.ref_id, cause);
    }
  }
  return settled;
}
