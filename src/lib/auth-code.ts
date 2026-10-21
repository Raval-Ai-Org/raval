import { supabase } from "@/integrations/supabase/client";

/** Keep the flow's verifier selection after credentials are scrubbed from the URL. */
export function exchangeAuthCode(url: URL) {
  const code = url.searchParams.get("code");
  if (!code) throw new Error("The authentication link is incomplete.");
  const flowId = url.searchParams.get("sb_flow_id");
  return flowId === null
    ? supabase.auth.exchangeCodeForSession(code)
    : supabase.auth.exchangeCodeForSession(code, { flowId });
}
