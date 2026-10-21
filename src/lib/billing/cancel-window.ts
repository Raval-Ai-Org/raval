// cancel-window.ts — where an account's monthly grant window sits right after its Stripe
// subscription is cancelled. Pure and browser-safe, so the rule is tested on its own.
//
// A cancelled subscription drops the account to Free, whose allowance starts now. Two cases
// must NOT restart the window:
//   * the account was already cancelled (a repeated webhook must not move it again), and
//   * the account is on a comped plan: it has its own monthly cadence, and restarting it
//     would make the billing job hand out the comped plan's whole allowance a second time in
//     the same month.

export type CancelWindowAccount = {
  status: string;
  next_grant_at: string | null;
  grant_anchor: string | null;
  comped_plan_id: string | null;
  comped_until: string | null;
};

export function isCompedAt(
  account: Pick<CancelWindowAccount, "comped_plan_id" | "comped_until">,
  now: Date,
): boolean {
  return Boolean(
    account.comped_plan_id && account.comped_until && new Date(account.comped_until) > now,
  );
}

export function windowAfterCancel(
  account: CancelWindowAccount,
  now: Date,
): { nextGrantAt: string; grantAnchor: string } {
  const keep = account.status === "canceled" || isCompedAt(account, now);
  return {
    nextGrantAt: keep && account.next_grant_at ? account.next_grant_at : now.toISOString(),
    grantAnchor: keep && account.grant_anchor ? account.grant_anchor : now.toISOString(),
  };
}
