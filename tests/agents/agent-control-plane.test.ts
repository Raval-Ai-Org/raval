// Agent control plane evaluation suite (audit Stage 4: "evaluation fixtures
// for stale, partial, failed, replayed, and contradictory states" and
// "tools reject wrong tenant, malformed input, unauthorized action, and unsafe
// retry"). Runs against the in-memory store and a tiny scoped fake db.
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeTool, executeRun, redactArgs } from "@/server/agents/runtime";
import { approveAction, rejectAction } from "@/server/agents/approvals";
import { decidePolicy } from "@/server/agents/policy";
import { memoryAgentStore } from "@/server/agents/store";
import { listTools } from "@/server/agents/registry";
import { ToolError, type ToolContext } from "@/server/agents/types";
import {
  analyzeDeliveryEvidence,
  distributionReliabilityWorker,
  type DeliveryEvidence,
} from "@/server/agents/workers/distribution-reliability";
import { contentFitIssues } from "@/server/agents/workers/content-fit";

const NOW = new Date("2026-09-12T12:00:00Z");
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const ITEM_A = "a0000000-0000-4000-8000-00000000000a";
const ITEM_B = "b0000000-0000-4000-8000-00000000000b";

/** Minimal Supabase-like db over plain arrays; supports the filters tools use. */
function fakeDb(tables: Record<string, Array<Record<string, any>>>) {
  const builder = (table: string) => {
    const filters: Array<(r: Record<string, any>) => boolean> = [];
    let patch: Record<string, any> | null = null;
    let insertRows: Array<Record<string, any>> | null = null;
    let limitN = Infinity;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const exec = () => {
      if (insertRows) {
        const created = insertRows.map((r, i) => ({
          id: `new-${table}-${(tables[table]?.length ?? 0) + i}`,
          ...r,
        }));
        tables[table] = [...(tables[table] ?? []), ...created];
        return created;
      }
      if (patch) {
        const hit = rows();
        hit.forEach((r) => Object.assign(r, patch));
        return hit;
      }
      return rows().slice(0, limitN);
    };
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(r[c])), b),
      lt: (c: string, v: any) => (filters.push((r) => r[c] < v), b),
      gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), b),
      not: () => b,
      order: () => b,
      limit: (n: number) => ((limitN = n), b),
      update: (p: Record<string, any>) => ((patch = p), b),
      insert: (r: any) => ((insertRows = Array.isArray(r) ? r : [r]), b),
      maybeSingle: async () => ({ data: exec()[0] ?? null, error: null }),
      single: async () => ({ data: exec()[0] ?? null, error: null }),
      then: (resolve: (v: any) => void) => resolve({ data: exec(), error: null }),
    };
    return b;
  };
  return { from: builder, tables };
}

function seedDb() {
  return fakeDb({
    content_items: [
      {
        id: ITEM_A,
        workspace_id: WS_A,
        channel: "x",
        kind: "post",
        status: "draft",
        title: "A",
        body: "Hello",
        hashtags: [],
        media_url: null,
      },
      {
        id: ITEM_B,
        workspace_id: WS_B,
        channel: "x",
        kind: "post",
        status: "draft",
        title: "B",
        body: "Secret B",
        hashtags: [],
        media_url: null,
      },
    ],
    content_publications: [],
    memory_insights: [],
  });
}

const userCtx = (
  db: any,
  role: "owner" | "editor" | "viewer" = "editor",
  ws = WS_A,
): ToolContext => ({
  workspaceId: ws,
  actor: { kind: "user", userId: "u-1", role },
  db,
  now: () => NOW,
});
const workerCtx = (db: any, ws = WS_A): ToolContext => ({
  workspaceId: ws,
  actor: { kind: "worker", worker: "distribution-reliability" },
  runId: "run-x",
  db,
  now: () => NOW,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("tool registry & policy", () => {
  it("exposes no publish, OAuth, credential or raw-SQL capability", () => {
    const names = listTools().map((t) => t.name);
    expect(names.some((n) => /publish|oauth|token|credential|sql|reconnect/i.test(n))).toBe(false);
    expect(listTools().every((t) => t.effect !== "external")).toBe(true);
    expect(
      listTools()
        .filter((t) => t.effect === "write")
        .every((t) => t.requiresApproval),
    ).toBe(true);
  });

  it("requires approval for writes, allows reads, denies below-role", () => {
    const settings = { agentsPaused: false, disabledWorkers: [] };
    const write = {
      name: "content.apply_revision",
      effect: "write" as const,
      minRole: "editor" as const,
    };
    const read = { name: "content.get", effect: "read" as const, minRole: "viewer" as const };
    const editor = { kind: "user" as const, userId: "u", role: "editor" as const };
    const viewer = { kind: "user" as const, userId: "u", role: "viewer" as const };
    expect(decidePolicy(write, editor, settings).decision).toBe("require_approval");
    expect(decidePolicy(write, editor, settings, { approvalGranted: true }).decision).toBe("allow");
    expect(decidePolicy(write, viewer, settings, { approvalGranted: true }).decision).toBe("deny");
    expect(decidePolicy(read, viewer, settings).decision).toBe("allow");
  });

  it("the workspace kill switch and the global flag deny workers", () => {
    const read = { name: "content.get", effect: "read" as const, minRole: "viewer" as const };
    const w = { kind: "worker" as const, worker: "distribution-reliability" };
    expect(decidePolicy(read, w, { agentsPaused: true, disabledWorkers: [] }).decision).toBe(
      "deny",
    );
    expect(
      decidePolicy(read, w, { agentsPaused: false, disabledWorkers: ["distribution-reliability"] })
        .decision,
    ).toBe("deny");
    vi.stubEnv("AGENTS_DISABLED", "true");
    expect(decidePolicy(read, w, { agentsPaused: false, disabledWorkers: [] }).decision).toBe(
      "deny",
    );
  });
});

describe("tool invocation", () => {
  it("rejects malformed input before touching data", async () => {
    const store = memoryAgentStore();
    await expect(
      invokeTool(userCtx(seedDb()), "content.get", { id: "not-a-uuid" }, { store }),
    ).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("rejects an unknown tool", async () => {
    await expect(
      invokeTool(userCtx(seedDb()), "db.execute_sql", {}, { store: memoryAgentStore() }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it("never reads another tenant's record (wrong tenant → not found)", async () => {
    await expect(
      invokeTool(userCtx(seedDb()), "content.get", { id: ITEM_B }, { store: memoryAgentStore() }),
    ).rejects.toThrow(/not found/i);
  });

  it("a worker's write becomes a suggested action request — nothing changes", async () => {
    const db = seedDb();
    const store = memoryAgentStore();
    const out = await invokeTool(
      workerCtx(db),
      "content.apply_revision",
      { contentItemId: ITEM_A, body: "Rewritten", reasons: ["too long"] },
      { store },
    );
    expect(out.status).toBe("pending_approval");
    expect(db.tables.content_items[0].body).toBe("Hello");
    expect([...store.actions.values()][0]).toMatchObject({
      status: "suggested",
      tool: "content.apply_revision",
    });
  });

  it("the same proposal twice is one request (idempotent suggestion)", async () => {
    const db = seedDb();
    const store = memoryAgentStore();
    const input = { contentItemId: ITEM_A, body: "Rewritten", reasons: [] };
    await invokeTool(workerCtx(db), "content.apply_revision", input, { store });
    await invokeTool(workerCtx(db), "content.apply_revision", input, { store });
    expect(store.actions.size).toBe(1);
  });

  it("redacts secrets from the audit trail", () => {
    expect(redactArgs({ token: "abc", nested: { apiKey: "k", text: "ok" } })).toEqual({
      token: "[redacted]",
      nested: { apiKey: "[redacted]", text: "ok" },
    });
  });
});

describe("approvals", () => {
  async function proposal() {
    const db = seedDb();
    const store = memoryAgentStore();
    const out = await invokeTool(
      workerCtx(db),
      "content.apply_revision",
      { contentItemId: ITEM_A, body: "Rewritten", reasons: [] },
      { store },
    );
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    return { db, store, id: out.actionRequest.id };
  }

  it("an editor's approval executes exactly that action once", async () => {
    const { db, store, id } = await proposal();
    const first = await approveAction({
      store,
      db,
      requestId: id,
      workspaceId: WS_A,
      userId: "u-1",
      role: "editor",
      now: () => NOW,
    });
    expect(first).toMatchObject({ ok: true, status: "executed" });
    expect(db.tables.content_items[0].body).toBe("Rewritten");
    const second = await approveAction({
      store,
      db,
      requestId: id,
      workspaceId: WS_A,
      userId: "u-2",
      role: "owner",
      now: () => NOW,
    });
    expect(second).toMatchObject({ ok: false, status: "conflict" });
  });

  it("a viewer cannot approve; the request stays suggested", async () => {
    const { db, store, id } = await proposal();
    const out = await approveAction({
      store,
      db,
      requestId: id,
      workspaceId: WS_A,
      userId: "v",
      role: "viewer",
      now: () => NOW,
    });
    expect(out).toMatchObject({ ok: false, status: "denied" });
    expect(db.tables.content_items[0].body).toBe("Hello");
    expect(store.actions.get(id)?.status).toBe("suggested");
  });

  it("a member of another workspace cannot see or approve it", async () => {
    const { db, store, id } = await proposal();
    const out = await approveAction({
      store,
      db,
      requestId: id,
      workspaceId: WS_B,
      userId: "u-b",
      role: "owner",
      now: () => NOW,
    });
    expect(out).toMatchObject({ ok: false, status: "not_found" });
  });

  it("an expired suggestion cannot be executed", async () => {
    const { db, store, id } = await proposal();
    const later = () => new Date(NOW.getTime() + 8 * 86_400_000);
    const out = await approveAction({
      store,
      db,
      requestId: id,
      workspaceId: WS_A,
      userId: "u",
      role: "owner",
      now: later,
    });
    expect(out).toMatchObject({ ok: false, status: "expired" });
    expect(db.tables.content_items[0].body).toBe("Hello");
  });

  it("rejection is recorded and blocks later approval", async () => {
    const { db, store, id } = await proposal();
    expect(
      (
        await rejectAction({
          store,
          requestId: id,
          workspaceId: WS_A,
          userId: "u",
          reason: "off-brand",
        })
      ).ok,
    ).toBe(true);
    const out = await approveAction({
      store,
      db,
      requestId: id,
      workspaceId: WS_A,
      userId: "u",
      role: "owner",
      now: () => NOW,
    });
    expect(out.ok).toBe(false);
  });
});

// ── Distribution Reliability evaluation fixtures ─────────────────────────
const baseEvidence = (over: Partial<DeliveryEvidence> = {}): DeliveryEvidence => ({
  now: NOW.toISOString(),
  stale: [],
  failures: [],
  contradictions: [],
  webhooks: { rejected: 0, stale: 0, verified: 5, lastRejectedAt: null },
  heartbeats: [{ job: "sdr-reconcile", lastSucceededAt: NOW.toISOString(), overdue: false }],
  summary: { published: 5 },
  ...over,
});
const pub = (id: string, over: Record<string, any> = {}) => ({
  id,
  content_item_id: `item-${id}`,
  platform: "linkedin",
  account_id: "acct-1",
  status: "publishing",
  updated_at: new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
  ...over,
});

describe("reliability worker — evaluation fixtures", () => {
  it("healthy workspace → no findings (no false positives)", () => {
    expect(analyzeDeliveryEvidence(baseEvidence())).toEqual([]);
  });

  it("stale deliveries + overdue reconcile → reconcile-focused finding", () => {
    const f = analyzeDeliveryEvidence(
      baseEvidence({
        stale: [pub("p1"), pub("p2")],
        heartbeats: [{ job: "sdr-reconcile", lastSucceededAt: null, overdue: true }],
      }),
    );
    const stale = f.find((x) => x.fingerprint === "stale-deliveries");
    expect(stale?.recommendedAction).toMatch(/scheduler|reconciliation/i);
    expect(stale?.affected.map((a) => a.id)).toEqual(["p1", "p2"]);
    expect(f.some((x) => x.fingerprint.startsWith("scheduler-overdue"))).toBe(true);
  });

  it("auth failures → one reconnect finding per account", () => {
    const f = analyzeDeliveryEvidence(
      baseEvidence({
        failures: [
          pub("f1", { status: "failed", error_category: "auth", account_id: "acct-9" }),
          pub("f2", { status: "failed", error_category: "auth", account_id: "acct-9" }),
        ],
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ fingerprint: "account-auth:acct-9", requiresHumanApproval: true });
  });

  it("partial failure (one platform failing repeatedly) → platform finding", () => {
    const f = analyzeDeliveryEvidence(
      baseEvidence({
        failures: [
          pub("x1", { status: "failed", platform: "twitter", error_category: "rate_limit" }),
          pub("x2", { status: "failed", platform: "twitter", error_category: "rate_limit" }),
        ],
      }),
    );
    expect(f[0].fingerprint).toBe("failures:twitter:rate_limit");
  });

  it("replayed/forged callbacks with nothing verified → critical", () => {
    const f = analyzeDeliveryEvidence(
      baseEvidence({
        webhooks: { rejected: 4, stale: 3, verified: 0, lastRejectedAt: NOW.toISOString() },
      }),
    );
    expect(f[0]).toMatchObject({ fingerprint: "webhook-rejections", severity: "critical" });
  });

  it("contradictory item vs delivery status → contradiction finding citing items", () => {
    const f = analyzeDeliveryEvidence(
      baseEvidence({
        contradictions: [
          {
            contentItemId: "i-1",
            itemStatus: "published",
            deliveryStatuses: ["published", "publishing"],
          },
        ],
      }),
    );
    expect(f[0].affected).toEqual([{ table: "content_items", id: "i-1" }]);
  });

  it("a full run is read-only, audited, and records findings", async () => {
    const db = fakeDb({
      content_publications: [
        { ...pub("p1"), workspace_id: WS_A },
        { ...pub("p-other"), workspace_id: WS_B },
      ],
      content_items: [],
      sdr_webhook_events: [],
      cron_heartbeats: [],
    });
    const store = memoryAgentStore();
    const out = await executeRun(distributionReliabilityWorker, {
      workspaceId: WS_A,
      trigger: "manual",
      store,
      db,
      input: { explain: false },
      now: () => NOW,
    });
    expect(out.status).toBe("succeeded");
    // Only the workspace's own stale delivery is cited.
    const stale = [...store.findings.values()].find((f) => f.fingerprint === "stale-deliveries");
    expect(stale?.affected.map((a) => a.id)).toEqual(["p1"]);
    // Every step is a read; nothing was proposed or written.
    expect(store.actions.size).toBe(0);
    expect(store.steps.every((s) => s.policyDecision !== "require_approval")).toBe(true);
    expect(db.tables.content_publications.find((p) => p.id === "p1")?.status).toBe("publishing");
    // Re-running bumps the same finding instead of duplicating it.
    await executeRun(distributionReliabilityWorker, {
      workspaceId: WS_A,
      trigger: "cron",
      store,
      db,
      input: { explain: false },
      now: () => NOW,
    });
    expect(
      [...store.findings.values()].filter((f) => f.fingerprint === "stale-deliveries")[0]
        .occurrences,
    ).toBe(2);
  });

  it("a paused workspace does not run at all", async () => {
    const store = memoryAgentStore({
      settings: { [WS_A]: { agentsPaused: true, disabledWorkers: [] } },
    });
    const out = await executeRun(distributionReliabilityWorker, {
      workspaceId: WS_A,
      trigger: "cron",
      store,
      db: fakeDb({}),
      now: () => NOW,
    });
    expect(out.status).toBe("failed");
    expect(store.runs.size).toBe(0);
  });
});

describe("content-fit deterministic checks", () => {
  it("flags an over-length X post and brand-safety claims", () => {
    const issues = contentFitIssues({
      channel: "x",
      title: "Launch",
      body: "Guaranteed results! ".repeat(20),
      hashtags: ["#launch"],
      media_url: null,
    });
    expect(issues.some((i) => i.rule === "platform:twitter")).toBe(true);
    expect(issues.some((i) => i.rule === "claim:guarantee")).toBe(true);
  });

  it("passes a clean post that fits", () => {
    expect(
      contentFitIssues({
        channel: "linkedin",
        title: "Hiring",
        body: "We're hiring a designer in Lahore.",
        hashtags: [],
        media_url: null,
      }),
    ).toEqual([]);
  });
});
