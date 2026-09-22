// The global single-flight lease over the shared provider basket.
//
// The provider has one account and one basket for all of Mellox, its pay call
// charges for the whole basket, and nothing can be removed from it. So at most
// one order cycle may touch the provider at a time, across requests, across
// serverless instances and across cron ticks.
//
// This is a lease row rather than an advisory lock because the critical section
// spans several HTTP round-trips: a transaction-scoped lock cannot outlive the
// RPC, a session-scoped lock is unusable behind a connection pooler, and an
// operator needs to be able to ask "who holds the basket" in SQL.
//
// `token` is a fencing token. Every write a cycle makes to its own order row
// carries it, so a process that wakes up after being taken over cannot write.
import "server-only";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PROVIDER = "rixot";
export const LEASE_SECONDS = 180;

/** Renew if the lease has less than this left before a money-critical call. */
export const LEASE_SAFETY_MS = 30_000;

export class ProviderLockLostError extends Error {
  constructor(message = "Another process took over the provider basket.") {
    super(message);
    this.name = "ProviderLockLostError";
  }
}

export type LockAcquired = {
  ok: true;
  token: string;
  /** The previous holder died mid-cycle; reconcile before writing anything. */
  takeover: boolean;
  previousOrderId: string | null;
};

export type LockRefused = {
  ok: false;
  code: "busy" | "quarantined" | "unknown_provider" | "error";
  reason: string | null;
  holderOrderId?: string | null;
};

export type LockResult = LockAcquired | LockRefused;

export async function acquireProviderLock(args: {
  holder: string;
  orderId: string;
  leaseSeconds?: number;
}): Promise<LockResult> {
  const { data, error } = await supabaseAdmin.rpc("acquire_provider_lock", {
    p_provider: PROVIDER,
    p_holder: args.holder,
    p_order_id: args.orderId,
    p_lease_seconds: args.leaseSeconds ?? LEASE_SECONDS,
  });

  if (error) return { ok: false, code: "error", reason: error.message };

  const result = data as Record<string, unknown> | null;
  if (!result || result.ok !== true) {
    const code = String(result?.code ?? "error");
    return {
      ok: false,
      code:
        code === "busy" || code === "quarantined" || code === "unknown_provider" ? code : "error",
      reason: typeof result?.reason === "string" ? result.reason : null,
      holderOrderId: typeof result?.order_id === "string" ? result.order_id : null,
    };
  }

  return {
    ok: true,
    token: String(result.token),
    takeover: result.takeover === true,
    previousOrderId: typeof result.previous_order_id === "string" ? result.previous_order_id : null,
  };
}

/** Returns false when the lease was lost; callers throw ProviderLockLostError. */
export async function renewProviderLock(
  token: string,
  phase?: string,
  leaseSeconds = LEASE_SECONDS,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("renew_provider_lock", {
    p_provider: PROVIDER,
    p_token: token,
    p_phase: phase ?? undefined,
    p_lease_seconds: leaseSeconds,
  });
  if (error) return false;
  return data === true;
}

/**
 * Renew, and throw if the lease is gone. Called immediately before each
 * money-critical POST so a zombie can never reach the provider.
 */
export async function assertProviderLock(token: string, phase: string): Promise<void> {
  const ok = await renewProviderLock(token, phase);
  if (!ok) throw new ProviderLockLostError();
}

export async function releaseProviderLock(token: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("release_provider_lock", {
    p_provider: PROVIDER,
    p_token: token,
  });
  if (error) return false;
  return data === true;
}

/**
 * Halts every order cycle. Deliberately not self-clearing: a stuck queue is
 * recoverable, an unattributed charge is not. Clearing it is an operator
 * action after the real basket has been read.
 */
export async function quarantineProviderLock(reason: string): Promise<void> {
  await supabaseAdmin.rpc("quarantine_provider_lock", {
    p_provider: PROVIDER,
    p_reason: reason,
  });
}

export type LockState = {
  holder: string | null;
  orderId: string | null;
  phase: string | null;
  leaseUntil: string | null;
  quarantined: boolean;
  quarantineReason: string | null;
  takeoverCount: number;
};

export async function readProviderLock(): Promise<LockState | null> {
  const { data, error } = await supabaseAdmin
    .from("provider_basket_lock")
    .select("holder, order_id, phase, lease_until, quarantined, quarantine_reason, takeover_count")
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (error || !data) return null;
  return {
    holder: data.holder,
    orderId: data.order_id,
    phase: data.phase,
    leaseUntil: data.lease_until,
    quarantined: data.quarantined === true,
    quarantineReason: data.quarantine_reason,
    takeoverCount: Number(data.takeover_count ?? 0),
  };
}

/** A worker id that identifies this process in the lock row and in the logs. */
export function workerId(): string {
  return `rixot-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}
