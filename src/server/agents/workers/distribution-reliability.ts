// distribution-reliability.ts — the first supervised Worker (audit §29.2).
//
// Goal: identify and explain publication delivery problems WITHOUT making any
// change. Autonomy L0/L1: it reads typed, workspace-scoped evidence, derives
// findings deterministically (so the evaluation suite can pin them), asks the
// economy model for plain-language hypotheses when available, and records
// findings for a human. It never publishes, reconnects, retries, cancels or
// edits delivery state — it has no tool that could.
import "server-only";
import { z } from "zod";
import type { WorkerDefinition } from "../runtime";
import type { Finding, FindingSeverity } from "../types";

export type DeliveryEvidence = {
  now: string;
  stale: Array<{ id: string; content_item_id: string; platform: string; account_id: string; status: string; updated_at: string; attempt?: number | null }>;
  failures: Array<{ id: string; content_item_id: string; platform: string; account_id: string; error_category?: string | null; last_error?: string | null; updated_at: string }>;
  contradictions: Array<{ contentItemId: string; itemStatus: string; deliveryStatuses: string[] }>;
  webhooks: { rejected: number; stale: number; verified: number; lastRejectedAt: string | null };
  heartbeats: Array<{ job: string; lastSucceededAt: string | null; overdue: boolean }>;
  summary: Record<string, number>;
};

const minutesSince = (now: string, iso: string) => (Date.parse(now) - Date.parse(iso)) / 60_000;

/**
 * Pure: evidence → findings. Every finding cites record ids, never guesses.
 * Exported for the evaluation suite (tests/agents).
 */
export function analyzeDeliveryEvidence(ev: DeliveryEvidence): Finding[] {
  const findings: Finding[] = [];

  // 1. Deliveries stuck in flight.
  if (ev.stale.length) {
    const oldest = Math.max(...ev.stale.map((r) => minutesSince(ev.now, r.updated_at)));
    const reconcileOverdue = ev.heartbeats.find((h) => h.job === "sdr-reconcile")?.overdue ?? false;
    const severity: FindingSeverity = oldest > 240 || ev.stale.length >= 10 ? "high" : "medium";
    findings.push({
      fingerprint: "stale-deliveries",
      severity,
      title: `${ev.stale.length} deliver${ev.stale.length === 1 ? "y is" : "ies are"} stuck in flight`,
      summary: `The oldest has not changed for ${Math.round(oldest)} minutes.`,
      evidence: ev.stale.slice(0, 10).map((r) => `${r.platform} delivery ${r.id} (${r.status}, last update ${r.updated_at})`),
      hypotheses: [
        reconcileOverdue
          ? "The reconciliation job has not run recently, so lost webhooks are not being recovered."
          : "Delivery webhooks from the distribution service were lost or rejected.",
        "The distribution worker may be down or backlogged.",
      ],
      affected: ev.stale.slice(0, 25).map((r) => ({ table: "content_publications", id: r.id })),
      recommendedAction: reconcileOverdue
        ? "Check the scheduler (cron) configuration, then run reconciliation."
        : "Check the distribution service's worker health; reconciliation will settle rows once it responds.",
      requiresHumanApproval: true,
      confidence: reconcileOverdue ? 0.8 : 0.6,
    });
  }

  // 2. Expired account authorization (auth failures), grouped per account.
  const authByAccount = new Map<string, typeof ev.failures>();
  for (const f of ev.failures.filter((x) => x.error_category === "auth")) {
    authByAccount.set(f.account_id, [...(authByAccount.get(f.account_id) ?? []), f]);
  }
  for (const [account, rows] of authByAccount) {
    findings.push({
      fingerprint: `account-auth:${account}`,
      severity: rows.length >= 3 ? "high" : "medium",
      title: `A connected ${rows[0].platform} account needs reconnecting`,
      summary: `${rows.length} deliver${rows.length === 1 ? "y" : "ies"} failed because the account's authorization expired or was revoked.`,
      evidence: rows.slice(0, 10).map((r) => `${r.platform} delivery ${r.id}: ${r.last_error ?? "auth failure"}`),
      hypotheses: ["The platform token expired or the user revoked access."],
      affected: rows.slice(0, 25).map((r) => ({ table: "content_publications", id: r.id })),
      recommendedAction: "Reconnect the account in Connections, then re-publish the failed items.",
      requiresHumanApproval: true,
      confidence: 0.9,
    });
  }

  // 3. Other repeated failures by platform + category.
  const other = new Map<string, typeof ev.failures>();
  for (const f of ev.failures.filter((x) => x.error_category !== "auth")) {
    const key = `${f.platform}:${f.error_category ?? "unknown"}`;
    other.set(key, [...(other.get(key) ?? []), f]);
  }
  for (const [key, rows] of other) {
    if (rows.length < 2) continue;
    const [platform, category] = key.split(":");
    findings.push({
      fingerprint: `failures:${key}`,
      severity: rows.length >= 5 ? "high" : "low",
      title: `${rows.length} ${platform} deliveries failed (${category})`,
      summary: `Repeated ${category} failures on ${platform} in the recent window.`,
      evidence: rows.slice(0, 10).map((r) => `${r.id}: ${r.last_error ?? category}`),
      hypotheses: [
        category === "validation"
          ? "Content violates a platform rule (length, media) — check the Content-Fit suggestions."
          : category === "rate_limit"
            ? "The platform rate-limited this account; posts are going out faster than allowed."
            : "The platform or the distribution adapter returned errors.",
      ],
      affected: rows.slice(0, 25).map((r) => ({ table: "content_publications", id: r.id })),
      recommendedAction: "Review the failed items; fix the content or wait out the limit, then re-publish.",
      requiresHumanApproval: true,
      confidence: 0.6,
    });
  }

  // 4. Status contradictions (item says one thing, deliveries another).
  if (ev.contradictions.length) {
    findings.push({
      fingerprint: "status-contradictions",
      severity: "medium",
      title: `${ev.contradictions.length} item${ev.contradictions.length === 1 ? "" : "s"} show a status their deliveries don't support`,
      summary: "Editorial status and delivery rows disagree; the calendar may be showing the wrong state.",
      evidence: ev.contradictions
        .slice(0, 10)
        .map((c) => `item ${c.contentItemId} is "${c.itemStatus}" but deliveries are [${c.deliveryStatuses.join(", ")}]`),
      hypotheses: ["A webhook was applied without recomputing the item status, or a status was edited by hand."],
      affected: ev.contradictions.slice(0, 25).map((c) => ({ table: "content_items", id: c.contentItemId })),
      recommendedAction: "Run reconciliation; it recomputes item status from the delivery rows.",
      requiresHumanApproval: true,
      confidence: 0.7,
    });
  }

  // 5. Webhook rejections — a security and reliability signal.
  const bad = ev.webhooks.rejected + ev.webhooks.stale;
  if (bad >= 3) {
    findings.push({
      fingerprint: "webhook-rejections",
      severity: ev.webhooks.verified === 0 ? "critical" : "high",
      title: `${bad} delivery callbacks were rejected in the last 24 hours`,
      summary:
        ev.webhooks.verified === 0
          ? "No callback verified in the window: delivery status is not being updated at all."
          : "Some callbacks failed signature or freshness checks.",
      evidence: [
        `rejected (bad signature): ${ev.webhooks.rejected}`,
        `stale (replayed or delayed): ${ev.webhooks.stale}`,
        `verified: ${ev.webhooks.verified}`,
        ...(ev.webhooks.lastRejectedAt ? [`last rejection at ${ev.webhooks.lastRejectedAt}`] : []),
      ],
      hypotheses: [
        "The webhook signing secret differs between the app and the distribution service (e.g. after a rotation).",
        "Someone is sending forged or replayed callbacks.",
        "Clock skew between the services beyond the freshness window.",
      ],
      affected: [],
      recommendedAction: "Compare the workspace webhook secret on both services; check server clocks. Rejected callbacks changed nothing.",
      requiresHumanApproval: true,
      confidence: 0.75,
    });
  }

  // 6. Scheduler heartbeats.
  const overdue = ev.heartbeats.filter((h) => h.overdue);
  if (overdue.length) {
    findings.push({
      fingerprint: `scheduler-overdue:${overdue.map((h) => h.job).sort().join(",")}`,
      severity: overdue.some((h) => h.job === "run-schedules") ? "high" : "medium",
      title: `Scheduled job${overdue.length === 1 ? "" : "s"} missed: ${overdue.map((h) => h.job).join(", ")}`,
      summary: "A background job has not succeeded within three times its expected interval.",
      evidence: overdue.map((h) => `${h.job}: last success ${h.lastSucceededAt ?? "never"}`),
      hypotheses: ["pg_cron jobs are not scheduled, the Vault secrets are missing, or the app rejected the cron secret."],
      affected: [],
      recommendedAction: "Follow the scheduler section of the operations runbook (docs/OPERATIONS-RUNBOOK.md).",
      requiresHumanApproval: true,
      confidence: 0.85,
    });
  }

  return findings;
}

const ExplanationSchema = z.object({
  explanations: z.array(z.object({ fingerprint: z.string(), hypothesis: z.string().max(400) })),
});

export const distributionReliabilityWorker: WorkerDefinition = {
  name: "distribution-reliability",
  objective:
    "Identify and explain publication delivery problems in this workspace. Read-only: recommend, never change.",
  budget: { maxSteps: 12, deadlineMs: 60_000, maxCostUsd: 0.05 },
  async run(ctx) {
    const call = async <O>(name: string, input: unknown): Promise<O> => {
      const r = await ctx.tool<O>(name, input);
      if (r.status !== "ok") throw new Error(`${name} unexpectedly required approval`);
      return r.output;
    };
    const evidence: DeliveryEvidence = {
      now: ctx.now().toISOString(),
      stale: await call("publications.list_stale", { olderThanMinutes: 30, limit: 50 }),
      failures: await call("publications.recent_failures", { hours: 72, limit: 100 }),
      contradictions: await call("content.status_contradictions", { limit: 100 }),
      webhooks: await call("webhooks.recent_rejections", { hours: 24 }),
      heartbeats: await call("scheduler.heartbeats", {}),
      summary: await call("publications.summary", { days: 7 }),
    };
    const findings = analyzeDeliveryEvidence(evidence);

    // Optional: plain-language hypotheses from the economy model. The
    // deterministic findings stand on their own if this fails.
    if (findings.length && ctx.input.explain !== false) {
      try {
        const { runStructuredPrompt } = await import("@/lib/ai/run.server");
        const { FAST_CHAT_MODEL } = await import("@/lib/ai-gateway.server");
        const out = await runStructuredPrompt({
          route: "agent.distribution-reliability",
          model: FAST_CHAT_MODEL,
          system:
            "You explain social-media delivery problems to a marketing team in one or two plain sentences each. Use only the evidence given. Do not invent causes beyond it. Return JSON {\"explanations\":[{\"fingerprint\":string,\"hypothesis\":string}]}.",
          user: JSON.stringify(
            findings.map((f) => ({ fingerprint: f.fingerprint, title: f.title, evidence: f.evidence.slice(0, 5) })),
          ),
          schema: ExplanationSchema,
          maxTokens: 700,
          temperature: 0.2,
        });
        for (const e of out.explanations) {
          const f = findings.find((x) => x.fingerprint === e.fingerprint);
          if (f && e.hypothesis.trim()) f.hypotheses = [e.hypothesis.trim(), ...f.hypotheses].slice(0, 4);
        }
        await ctx.note("Model added plain-language hypotheses", { explained: out.explanations.length });
      } catch (error) {
        await ctx.note("Model explanation unavailable — deterministic findings only", {
          error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
        });
      }
    }

    let created = 0;
    for (const f of findings) {
      if ((await ctx.store.upsertFinding(ctx.workspaceId, ctx.runId, "distribution-reliability", f)) === "created") {
        created++;
      }
    }
    const summary = findings.length
      ? `${findings.length} issue${findings.length === 1 ? "" : "s"} found (${created} new): ${findings.map((f) => f.title).join("; ")}`
      : `No delivery problems found. Last 7 days: ${JSON.stringify(evidence.summary)}`;
    return { summary };
  },
};
