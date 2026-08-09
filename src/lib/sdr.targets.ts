// sdr.targets.ts — destination-selection gating (spec FR-004/FR-007). Only
// ACTIVE accounts are publishable; expired/disconnected are excluded so the
// picker never offers a target that would fail on auth (FR-004). Shared by the
// destination picker (US2) and the Connections view (US1).
import type { ConnectedAccount } from "@/lib/sdr.handlers";

export function isAccountPublishable(account: Pick<ConnectedAccount, "status"> | undefined | null): boolean {
  return account?.status === "active";
}

/** Filter a workspace's connected accounts down to publishable (active) ones. */
export function getPublishableAccounts(accounts: ConnectedAccount[]): ConnectedAccount[] {
  return accounts.filter(isAccountPublishable);
}

/**
 * Given the picker selection, resolve the concrete account ids to publish to.
 * `selection` is one of: { type: "account", accountId } | { type: "platform",
 * platform } | { type: "all" }. Expired/disconnected accounts are never included.
 */
export function resolveTargetAccounts(
  accounts: ConnectedAccount[],
  selection: { type: "account"; accountId: string } | { type: "platform"; platform: string } | { type: "all" },
): ConnectedAccount[] {
  const publishable = getPublishableAccounts(accounts);
  switch (selection.type) {
    case "account":
      return publishable.filter((a) => a.accountId === selection.accountId);
    case "platform":
      return publishable.filter((a) => a.platform === selection.platform);
    case "all":
      return publishable;
  }
}
