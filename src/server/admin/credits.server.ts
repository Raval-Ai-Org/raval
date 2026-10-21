// Goodwill credit adjustments from the admin console. The ledger is the billing
// module's: this only calls grantMeter (source "adjustment", AI-only so it can't
// buy backlinks), keyed by an operation id so a double click is a replay. The
// grant itself is idempotent; the audit row is written right after it succeeds,
// and a refused or failed attempt is audited as a failure.
import "server-only";
import { accountForWorkspace } from "@/server/billing/accounts.server";
import { grantMeter } from "@/server/billing/meters.server";
import type { AdminCreditGrantResult } from "@/lib/admin/types";
import { recordAdminAudit, type AuditContext } from "./audit.server";

export const CREDIT_GRANT_LIMITS = { credits: 2000, video: 1000 } as const;
export type CreditGrantMeter = keyof typeof CREDIT_GRANT_LIMITS;

export type CreditGrantInput = {
  workspaceId: string;
  meter: CreditGrantMeter;
  amount: number;
  reason: string;
  operationId: string;
};

export async function grantGoodwill(
  actor: { actorId: string; actorRole: string; audit: AuditContext },
  input: CreditGrantInput,
): Promise<AdminCreditGrantResult> {
  const entry = {
    actorUserId: actor.actorId,
    actorRole: actor.actorRole,
    action: "credits.granted",
    targetType: "workspace",
    targetId: input.workspaceId,
    workspaceId: input.workspaceId,
    reason: input.reason,
  };
  try {
    const { account } = await accountForWorkspace(input.workspaceId);
    const result = await grantMeter({
      accountId: account.id,
      meter: input.meter,
      amount: input.amount,
      source: "adjustment",
      restriction: "ai_only",
      idempotencyKey: `admin:${input.operationId}`,
      workspaceId: input.workspaceId,
      reason: input.reason,
      actor: actor.actorId,
    });
    const replayed = Boolean(result.replayed);
    if (!replayed) {
      await recordAdminAudit(
        {
          ...entry,
          after: { meter: input.meter, amount: input.amount, accountId: account.id },
        },
        actor.audit,
      );
    }
    return { replayed };
  } catch (error) {
    await recordAdminAudit(
      {
        ...entry,
        after: { meter: input.meter, amount: input.amount },
        success: false,
        error: error instanceof Error ? error.message : "Grant failed",
      },
      actor.audit,
    );
    throw error;
  }
}
