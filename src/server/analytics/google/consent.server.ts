import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { GOOGLE_DISCLOSURE_VERSION } from "@/marketing/lib/google-disclosure";
import { HttpError } from "@/server/http-error";

export async function requireGoogleAiConsent(
  db: SupabaseClient<Database>,
  workspaceId: string,
): Promise<string> {
  const { data, error } = await db
    .from("workspace_connections")
    .select("id, metadata")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google")
    .neq("status", "revoked");
  if (error) throw new Error(error.message);
  if (
    (data ?? []).some((row) => {
      const metadata = row.metadata as Record<string, unknown> | null;
      return (
        metadata?.disclosureVersion !== GOOGLE_DISCLOSURE_VERSION || metadata?.aiProcessing !== true
      );
    })
  )
    throw new HttpError(
      409,
      "A workspace admin must reconnect Google and review the updated AI data disclosure before Google reports are processed by AI.",
    );
  return (data ?? [])
    .map((row) => row.id)
    .sort()
    .join(",");
}
