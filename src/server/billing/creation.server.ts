import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { CREATION_POLICY } from "@/lib/billing/creation";

const admin = supabaseAdmin as unknown as SupabaseClient;

export async function creationPolicyFor(accountId: string, at = new Date()): Promise<boolean> {
  const { data, error } = await admin
    .from("billing_creation_windows")
    .select("policy")
    .eq("account_id", accountId)
    .lte("window_start", at.toISOString())
    .gt("expires_at", at.toISOString())
    .order("window_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Deploy code before its additive migration without changing existing terms.
  if (error?.code === "PGRST205" || error?.code === "42P01") return false;
  if (error) throw new HttpError(503, "Could not load creation allowance.");
  return data?.policy === CREATION_POLICY;
}

export async function reserveCaptionEdit(args: {
  accountId: string;
  workspaceId: string;
  userId: string;
  requestKey: string;
  parentJobId: string;
}): Promise<{ id: string; chargeId: string | null } | null> {
  const { data, error } = await admin.rpc("reserve_studio_caption_edit", {
    p: {
      account_id: args.accountId,
      workspace_id: args.workspaceId,
      user_id: args.userId,
      request_key: args.requestKey,
      parent_job_id: args.parentJobId,
    },
  });
  if (error) throw new HttpError(503, "Could not reserve your included caption edit.");
  if (data?.replayed && data.state === "released")
    throw new HttpError(
      410,
      "The previous edit was stopped and returned. Try again to start a new request.",
    );
  if (data?.replayed)
    throw new HttpError(409, "This caption edit is already running or completed.");
  return data?.included && typeof data.id === "string"
    ? { id: data.id, chargeId: typeof data.charge_id === "string" ? data.charge_id : null }
    : null;
}

export async function settleCaptionEdit(
  id: string,
  status: "captured" | "released",
  jobId?: string,
) {
  const { error } = await admin
    .from("studio_caption_edits")
    .update({ state: status, ...(jobId ? { job_id: jobId } : {}) })
    .eq("id", id)
    .eq("state", "reserved");
  if (error) throw new HttpError(503, "Could not update your included caption edit.");
}

export async function linkCaptionEdit(id: string, jobId: string) {
  const { error } = await admin
    .from("studio_caption_edits")
    .update({ job_id: jobId })
    .eq("id", id)
    .eq("state", "reserved");
  if (error) throw new HttpError(503, "Could not save your included caption edit.");
}

export async function captionEditsRemaining(workspaceId: string, groupId: string): Promise<number> {
  const { data, error } = await admin.rpc("studio_caption_edits_remaining", {
    p_workspace: workspaceId,
    p_group: groupId,
  });
  if (error) throw new HttpError(503, "Could not load your included caption edits.");
  return Math.max(0, Math.min(3, Number(data ?? 0)));
}
