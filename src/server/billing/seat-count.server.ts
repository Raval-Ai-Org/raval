import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/server/http-error";

const PAGE_SIZE = 1000;

/** Count paid seats across an account's active workspaces. */
export async function accountBillableSeatCount(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  workspaceIds: string[],
): Promise<number> {
  const { data, error } = await admin.rpc("account_billable_seat_count", {
    p_account: accountId,
  });
  if (!error) return Number(data);

  // Older databases may have the billing tables but not the seat-count RPC.
  // Count through the same active workspaces instead of failing every paid action.
  if (error.code !== "PGRST202") {
    throw new HttpError(503, "Could not check account seats. Please try again later.");
  }
  if (!workspaceIds.length) return 1;

  const members = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await admin
      .from("workspace_members")
      .select("user_id,workspace_id")
      .in("workspace_id", workspaceIds)
      .in("role", ["owner", "admin", "editor"])
      .neq("user_id", ownerUserId)
      .order("workspace_id")
      .order("user_id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (page.error) {
      throw new HttpError(503, "Could not check account seats. Please try again later.");
    }
    for (const member of page.data ?? []) members.add(String(member.user_id));
    if ((page.data?.length ?? 0) < PAGE_SIZE) break;
  }
  return 1 + members.size;
}
