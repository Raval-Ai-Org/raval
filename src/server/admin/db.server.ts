// db.server.ts — the admin console's only door to the database.
//
// Admin tables and functions are service-role only (see the migration), so
// this is the one place under src/server/admin that imports `supabaseAdmin`.
// Reads and writes go through the narrow functions in the migration, which
// write the audit row in the same transaction as the change.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";

export const adminDb = supabaseAdmin as unknown as SupabaseClient;

type PgError = { code?: string; message?: string };

/** Map a Postgres error from an admin function to an HTTP error a person can read. */
export function httpErrorFromPg(error: PgError, fallback: string): HttpError {
  switch (error.code) {
    case "42501":
      return new HttpError(403, error.message || "Not allowed.");
    case "P0002":
      return new HttpError(404, error.message || "Not found.");
    case "23514":
      return new HttpError(409, error.message || "That change is not allowed.");
    case "22023":
      return new HttpError(400, error.message || "Invalid request.");
    default:
      console.error("[admin] database error", error.code, error.message);
      return new HttpError(503, fallback);
  }
}

/** Call an admin function. Throws an HttpError; never returns an error object. */
export async function adminRpc<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  fallback = "The admin service is unavailable.",
): Promise<T> {
  const { data, error } = await adminDb.rpc(name, args);
  if (error) throw httpErrorFromPg(error, fallback);
  return data as T;
}
