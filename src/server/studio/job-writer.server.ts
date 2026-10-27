import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Call only after the API verifies workspace membership and the runner reads
 * the target through its authorized client. Job state and provider task IDs
 * are server-owned; content reads/writes keep using the caller's RLS client.
 * The argument allows the test store adapter to share the authorized fixture.
 */
export function studioJobWriter(_verifiedClient: SupabaseClient): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
