// Read-only insight for the admin console: analytics, integration state and a
// universal lookup. All three are narrow database functions over stored rows.
import "server-only";
import type { AdminAnalytics, AdminIntegrations, AdminLookup } from "@/lib/admin/types";
import { showEmail } from "./audit-read.server";
import { adminRpc } from "./db.server";

const n = (value: unknown) => Number(value ?? 0);
const triple = (raw: Record<string, unknown>) => ({
  day: n(raw.day),
  week: n(raw.week),
  month: n(raw.month),
});

type RawAnalytics = {
  generated_at: string;
  days: number;
  signups_by_day: Array<{ day: string; signups: number }>;
  ai_active: Record<string, unknown>;
  signed_in: Record<string, unknown>;
  funnel: Record<string, unknown>;
  plans: Array<{ plan_id: string; status: string; accounts: number }>;
  adoption: Array<{ kind: string; workspaces: number; users: number }>;
};

export async function getAnalytics(days: number): Promise<AdminAnalytics> {
  const raw = await adminRpc<RawAnalytics>(
    "admin_analytics",
    { p_days: days },
    "Analytics are unavailable.",
  );
  return {
    generatedAt: raw.generated_at,
    days: n(raw.days),
    signupsByDay: raw.signups_by_day.map((r) => ({ day: r.day, signups: n(r.signups) })),
    aiActive: triple(raw.ai_active),
    signedIn: triple(raw.signed_in),
    funnel: {
      signedUp: n(raw.funnel.signed_up),
      hasWorkspace: n(raw.funnel.has_workspace),
      usedAi: n(raw.funnel.used_ai),
      paying: n(raw.funnel.paying),
    },
    plans: raw.plans.map((r) => ({ planId: r.plan_id, status: r.status, accounts: n(r.accounts) })),
    adoption: raw.adoption.map((r) => ({
      kind: r.kind,
      workspaces: n(r.workspaces),
      users: n(r.users),
    })),
  };
}

type RawIntegrations = {
  generated_at: string;
  social: Array<{ platform: string; status: string; accounts: number }>;
  connections: Array<{ provider: string; status: string; connections: number }>;
  problems: Array<{
    source: "social" | "connection";
    provider: string;
    status: string;
    workspace_id: string;
    message: string;
    at: string;
  }>;
};

export async function getIntegrations(): Promise<AdminIntegrations> {
  const raw = await adminRpc<RawIntegrations>(
    "admin_integrations",
    {},
    "Integration state is unavailable.",
  );
  return {
    generatedAt: raw.generated_at,
    social: raw.social.map((r) => ({
      platform: r.platform,
      status: r.status,
      accounts: n(r.accounts),
    })),
    connections: raw.connections.map((r) => ({
      provider: r.provider,
      status: r.status,
      connections: n(r.connections),
    })),
    problems: raw.problems.map((r) => ({
      source: r.source,
      provider: r.provider,
      status: r.status,
      workspaceId: r.workspace_id,
      message: r.message,
      at: r.at,
    })),
  };
}

type RawLookup = {
  users: Array<{ id: string; email: string | null; name: string | null; created_at: string }>;
  workspaces: Array<{ id: string; name: string; domain: string | null; created_at: string }>;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    workspace_id: string;
    updated_at: string;
  }>;
};

export async function lookup(query: string, pii: boolean): Promise<AdminLookup> {
  const raw = await adminRpc<RawLookup>(
    "admin_lookup",
    { p_query: query, p_match_email: pii },
    "Search is unavailable.",
  );
  return {
    users: raw.users.map((u) => ({
      id: u.id,
      email: showEmail(u.email, pii),
      name: u.name,
      createdAt: u.created_at,
    })),
    workspaces: raw.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      domain: w.domain,
      createdAt: w.created_at,
    })),
    jobs: raw.jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      workspaceId: j.workspace_id,
      updatedAt: j.updated_at,
    })),
  };
}
