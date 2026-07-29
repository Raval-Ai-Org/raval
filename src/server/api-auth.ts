// Shared helpers for server-route handlers (Authorization, SSRF guard, errors)
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function requireUserId(request: Request): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: Response }
> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return { ok: false, response: jsonError(500, "Server not configured") };
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, response: jsonError(401, "Authentication required") };
  }
  const token = auth.slice(7).trim();
  if (!token) return { ok: false, response: jsonError(401, "Authentication required") };

  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return { ok: false, response: jsonError(401, "Invalid session") };
  }
  return { ok: true, userId: data.claims.sub as string };
}

// SSRF guard: only allow http(s) public hosts.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
  /\.internal$/i,
  /\.local$/i,
];

export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error("URL host is not allowed");
  }
  return u;
}
