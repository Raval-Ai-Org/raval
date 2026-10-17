// Abuse signals: candidates worth a look, found by fixed rules over stored rows
// (see admin_abuse_signals for the thresholds). They only list. Nothing here
// suspends, blocks or changes anyone: an admin who agrees acts from the user or
// workspace page, with a reason, like any other change.
import "server-only";
import type { AdminAbuseSignals } from "@/lib/admin/types";
import { adminRpc } from "./db.server";

type Num = number | string;
type Raw = {
  generated_at: string;
  signup_bursts: Array<{ domain: string; hour: string; accounts: Num }>;
  cost_spikes: Array<{
    workspace_id: string;
    name: string | null;
    cost_24h: Num;
    avg_daily_7d: Num;
  }>;
  failing_users: Array<{ user_id: string; calls: Num; bad_calls: Num }>;
  heavy_users: Array<{ user_id: string; hour: string; calls: Num }>;
  failing_workspaces: Array<{ workspace_id: string; name: string | null; failed: Num }>;
};

const n = (value: unknown) => Number(value ?? 0);

export async function getAbuseSignals(): Promise<AdminAbuseSignals> {
  const raw = await adminRpc<Raw>("admin_abuse_signals", {}, "Abuse signals are unavailable.");
  // A signup-burst row names an email domain (an organisation), never an address.
  return {
    generatedAt: raw.generated_at,
    signupBursts: raw.signup_bursts.map((r) => ({
      domain: r.domain,
      hour: r.hour,
      accounts: n(r.accounts),
    })),
    costSpikes: raw.cost_spikes.map((r) => ({
      workspaceId: r.workspace_id,
      name: r.name,
      cost24hUsd: n(r.cost_24h),
      avgDaily7dUsd: n(r.avg_daily_7d),
    })),
    failingUsers: raw.failing_users.map((r) => ({
      userId: r.user_id,
      calls: n(r.calls),
      badCalls: n(r.bad_calls),
    })),
    heavyUsers: raw.heavy_users.map((r) => ({
      userId: r.user_id,
      hour: r.hour,
      calls: n(r.calls),
    })),
    failingWorkspaces: raw.failing_workspaces.map((r) => ({
      workspaceId: r.workspace_id,
      name: r.name,
      failed: n(r.failed),
    })),
  };
}
