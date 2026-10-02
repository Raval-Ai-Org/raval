// store.memory.ts — the Autopilot store in memory, with the same lease and
// compare-and-set semantics as Postgres. The engine's tests run against this.
import type { ActionRow, EventRow, OpportunityRow, ProgramRow } from "@/lib/autopilot/contracts";
import { WORKER_STATUSES } from "@/lib/autopilot/state";
import type { AutopilotStore } from "./engine";

export type MemoryAutopilotStore = AutopilotStore & {
  actions: ActionRow[];
  programs: ProgramRow[];
  opportunities: OpportunityRow[];
  events: EventRow[];
  /** The clock the lease and due checks read. */
  now: () => Date;
};

let seq = 0;
const id = (prefix: string) => `${prefix}0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function createMemoryAutopilotStore(
  now: () => Date = () => new Date(),
): MemoryAutopilotStore {
  const actions: ActionRow[] = [];
  const programs: ProgramRow[] = [];
  const opportunities: OpportunityRow[] = [];
  const events: EventRow[] = [];
  const iso = () => now().toISOString();

  const store: MemoryAutopilotStore = {
    actions,
    programs,
    opportunities,
    events,
    now,

    async claim(worker, max, leaseSeconds, onlyId) {
      const at = now().getTime();
      const due = actions
        .filter((a) => {
          if (!WORKER_STATUSES.includes(a.status)) return false;
          if (onlyId && a.id !== onlyId) return false;
          if (Date.parse(a.next_attempt_at) > at) return false;
          if (a.lease_until && Date.parse(a.lease_until) >= at) return false;
          if (a.program_id) {
            const program = programs.find((p) => p.id === a.program_id);
            if (!program || program.status !== "running") return false;
          }
          return true;
        })
        .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
        .slice(0, max);
      for (const a of due) {
        a.lease_until = new Date(at + leaseSeconds * 1000).toISOString();
        a.locked_by = worker;
      }
      return due.map((a) => ({ ...a }));
    },

    async transition(action, to, patch = {}, opts = {}) {
      const row = actions.find((a) => a.id === action.id);
      if (!row || row.status !== action.status) return false;
      if (opts.worker && row.locked_by !== opts.worker) return false;
      Object.assign(row, patch, { status: to, updated_at: iso() });
      if (!opts.keepLease) {
        row.lease_until = null;
        row.locked_by = null;
      }
      return true;
    },

    async release(action, worker, patch = {}) {
      const row = actions.find((a) => a.id === action.id);
      if (!row || row.locked_by !== worker) return;
      Object.assign(row, patch, { lease_until: null, locked_by: null, updated_at: iso() });
    },

    async insertActions(rows) {
      const inserted: ActionRow[] = [];
      for (const input of rows) {
        if (
          actions.some(
            (a) => a.workspace_id === input.workspace_id && a.dedupe_key === input.dedupe_key,
          )
        ) {
          continue;
        }
        const row: ActionRow = {
          id: id("a"),
          program_id: null,
          status: "planned",
          cycle: 0,
          slot: null,
          planned_for: null,
          platform: null,
          content_type: null,
          title: "",
          brief: "",
          reason: "",
          goal: null,
          opportunity_id: null,
          requested_by: null,
          studio_job_id: null,
          content_item_ids: [],
          generation_attempt: 0,
          credits_charged: 0,
          approved_by: null,
          approved_via: null,
          result: {},
          next_attempt_at: iso(),
          lease_until: null,
          locked_by: null,
          attempts: 0,
          last_error: null,
          created_at: iso(),
          updated_at: iso(),
          finished_at: null,
          ...input,
        };
        actions.push(row);
        inserted.push({ ...row });
      }
      return inserted;
    },

    async getAction(workspaceId, actionId) {
      const row = actions.find((a) => a.id === actionId && a.workspace_id === workspaceId);
      return row ? { ...row } : null;
    },

    async listActions(workspaceId, opts = {}) {
      return actions
        .filter(
          (a) =>
            a.workspace_id === workspaceId &&
            (!opts.statuses?.length || opts.statuses.includes(a.status)) &&
            (!opts.kind || a.kind === opts.kind) &&
            (!opts.since || a.updated_at >= opts.since),
        )
        .sort((a, b) => (a.planned_for ?? "").localeCompare(b.planned_for ?? ""))
        .slice(0, opts.limit ?? 100)
        .map((a) => ({ ...a }));
    },

    async usage(programId, cycle) {
      const rows = actions.filter(
        (a) => a.program_id === programId && a.cycle === cycle && a.kind === "content",
      );
      return {
        credits: rows.reduce((n, a) => n + a.credits_charged, 0),
        videos: rows.filter(
          (a) =>
            a.content_type === "video" &&
            !["proposed", "planned", "skipped", "failed", "cancelled"].includes(a.status),
        ).length,
      };
    },

    async autoApprovedSince(workspaceId, since) {
      return actions.filter(
        (a) => a.workspace_id === workspaceId && a.approved_via === "auto" && a.updated_at >= since,
      ).length;
    },

    async autoActedInCycle(programId, cycle) {
      return actions.filter(
        (a) =>
          a.program_id === programId &&
          a.cycle === cycle &&
          a.opportunity_id &&
          !a.requested_by &&
          a.dedupe_key.startsWith("opp:"),
      ).length;
    },

    async openActionCount(programId) {
      return actions.filter(
        (a) =>
          a.program_id === programId &&
          (a.status === "proposed" || WORKER_STATUSES.includes(a.status)),
      ).length;
    },

    async getProgram(programId) {
      const row = programs.find((p) => p.id === programId);
      return row ? { ...row } : null;
    },

    async liveProgram(workspaceId) {
      const row = programs.find(
        (p) => p.workspace_id === workspaceId && (p.status === "running" || p.status === "paused"),
      );
      return row ? { ...row } : null;
    },

    async insertProgram(input) {
      if (
        programs.some(
          (p) => p.workspace_id === input.workspace_id && ["running", "paused"].includes(p.status),
        )
      ) {
        throw new Error("duplicate key value violates unique constraint");
      }
      const row: ProgramRow = {
        strategy: {},
        automations: ["geo_scan"],
        last_notified_at: null,
        ...input,
        id: id("p"),
        cycle: 0,
        pause_reason: null,
        created_at: iso(),
        updated_at: iso(),
        finished_at: null,
      };
      programs.push(row);
      return { ...row };
    },

    async updateProgram(programId, patch, expectStatus) {
      const row = programs.find((p) => p.id === programId);
      if (!row || (expectStatus && row.status !== expectStatus)) return false;
      Object.assign(row, patch, { updated_at: iso() });
      return true;
    },

    async knownFingerprints(workspaceId, since) {
      return opportunities
        .filter((o) => o.workspace_id === workspaceId && o.created_at >= since)
        .map((o) => ({ fingerprint: o.fingerprint, title: o.title }));
    },

    async insertOpportunities(rows) {
      const inserted: OpportunityRow[] = [];
      for (const input of rows) {
        if (
          opportunities.some(
            (o) => o.workspace_id === input.workspace_id && o.fingerprint === input.fingerprint,
          )
        ) {
          continue;
        }
        const row: OpportunityRow = {
          ...input,
          id: id("b"),
          status: "new",
          decided_by: null,
          decided_at: null,
          created_at: iso(),
          updated_at: iso(),
        };
        opportunities.push(row);
        inserted.push({ ...row });
      }
      return inserted;
    },

    async getOpportunity(workspaceId, opportunityId) {
      const row = opportunities.find(
        (o) => o.id === opportunityId && o.workspace_id === workspaceId,
      );
      return row ? { ...row } : null;
    },

    async listOpportunities(workspaceId, opts = {}) {
      return opportunities
        .filter(
          (o) =>
            o.workspace_id === workspaceId &&
            o.expires_at > iso() &&
            (!opts.statuses?.length || opts.statuses.includes(o.status)),
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.limit ?? 30)
        .map((o) => ({ ...o }));
    },

    async updateOpportunity(opportunityId, patch, expectStatus) {
      const row = opportunities.find((o) => o.id === opportunityId);
      if (!row || (expectStatus && row.status !== expectStatus)) return false;
      Object.assign(row, patch, { updated_at: iso() });
      return true;
    },

    async expireOpportunities(workspaceId, at) {
      for (const o of opportunities) {
        if (o.workspace_id === workspaceId && o.status === "new" && o.expires_at <= at) {
          o.status = "expired";
        }
      }
    },

    async addEvent(event) {
      events.push({
        id: id("e"),
        program_id: null,
        action_id: null,
        opportunity_id: null,
        data: {},
        actor: "system",
        actor_id: null,
        created_at: iso(),
        ...event,
      });
    },

    async listEvents(workspaceId, limit) {
      return events
        .filter((e) => e.workspace_id === workspaceId)
        .slice(-limit)
        .reverse()
        .map((e) => ({ ...e }));
    },
  };
  return store;
}
